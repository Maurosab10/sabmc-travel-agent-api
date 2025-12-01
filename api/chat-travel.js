import OpenAI from "openai";

// ID del assistant (lo lees desde variables de entorno)
const ASSISTANT_ID = process.env.ASSISTANT_ID;

// Pequeña pausa entre polls
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Función para buscar en la web usando SerpAPI ---
async function searchWeb(query) {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return `No tengo configurada la clave de SerpAPI, pero con la información general que manejo puedo decirte lo siguiente sobre: ${query}`;
  }

  const url =
    "https://serpapi.com/search.json?engine=google&q=" +
    encodeURIComponent(query) +
    "&api_key=" +
    apiKey;

  const resp = await fetch(url);
  if (!resp.ok) {
    return `No pude acceder al buscador en este momento (status ${resp.status}). Usa esta información solo como referencia general sobre: ${query}`;
  }

  const data = await resp.json();

  const results = data.organic_results || [];
  if (!results.length) {
    return `No encontré resultados claros en la web. Te doy una respuesta general sobre: ${query}`;
  }

  // Tomamos los primeros 3 resultados y los resumimos
  const lines = results.slice(0, 3).map((r, i) => {
    const title = r.title || "Sin título";
    const snippet = r.snippet || "";
    const link = r.link || "";
    return `${i + 1}. ${title}\n${snippet}\nFuente: ${link}`;
  });

  return (
    "Resumen de lo que encontré en la web sobre: " +
    query +
    "\n\n" +
    lines.join("\n\n")
  );
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("Falta la variable de entorno OPENAI_API_KEY");
    return res
      .status(500)
      .json({ error: "Configuración incompleta: falta OPENAI_API_KEY" });
  }

  if (!ASSISTANT_ID) {
    console.error("Falta la variable de entorno ASSISTANT_ID");
    return res
      .status(500)
      .json({ error: "Configuración incompleta: falta ASSISTANT_ID" });
  }

  const client = new OpenAI({ apiKey });

  try {
    const { messages, threadId } = req.body;
    let thread;

    if (threadId) {
      thread = await client.beta.threads.retrieve(threadId);
      await client.beta.threads.messages.create(thread.id, {
        role: "user",
        content: messages[messages.length - 1].content,
      });
    } else {
      thread = await client.beta.threads.create({
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
    }

    // Creamos el run SIN hacer createAndPoll para poder manejar tools
    let run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    // Bucle de polling: manejamos tools y esperamos a que termine
    while (true) {
      if (
        run.status === "completed" ||
        run.status === "failed" ||
        run.status === "cancelled" ||
        run.status === "expired"
      ) {
        break;
      }

      if (run.status === "requires_action") {
        const action = run.required_action;
        if (action?.type === "submit_tool_outputs") {
          const toolCalls = action.submit_tool_outputs.tool_calls || [];

          const toolOutputs = [];
          for (const toolCall of toolCalls) {
            const fn = toolCall.function;
            const name = fn.name;
            let args = {};
            try {
              args = JSON.parse(fn.arguments || "{}");
            } catch (e) {
              console.error("No pude parsear argumentos de la función:", e);
            }

            if (name === "search_web") {
              const query = args.query || "";
              const resultText = await searchWeb(query);
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output: resultText,
              });
            } else {
              // Si algún día agregas más funciones, las manejas aquí
              toolOutputs.push({
                tool_call_id: toolCall.id,
                output:
                  "Función no implementada en el servidor: " +
                  name +
                  ". Usa solo el conocimiento general.",
              });
            }
          }

          // Enviamos los resultados de las tools al run
          run = await client.beta.threads.runs.submitToolOutputs(
            thread.id,
            run.id,
            {
              tool_outputs: toolOutputs,
            }
          );
        }
      } else {
        // Si está en queued/in_progress, esperamos y volvemos a consultar
        await wait(1500);
        run = await client.beta.threads.runs.retrieve(thread.id, run.id);
      }
    }

    if (run.status !== "completed") {
      console.error("Run terminó con estado:", run.status);
      return res
        .status(500)
        .json({ error: "El asistente no pudo completar la respuesta." });
    }

    // Ya terminó: leemos la última respuesta
    const messagesResponse = await client.beta.threads.messages.list(thread.id);
    const lastMessage = messagesResponse.data[0];
    const answer = lastMessage.content[0]?.text?.value || "";

    return res.status(200).json({
      threadId: thread.id,
      answer,
    });
  } catch (error) {
    console.error("Error en chat-travel:", error);
    return res
      .status(500)
      .json({ error: "Error hablando con el travel advisor" });
  }
}
