import OpenAI from "openai";

// Leemos el Assistant ID desde variables de entorno
const ASSISTANT_ID = process.env.ASSISTANT_ID;

export default async function handler(req, res) {
  // 🔹 CORS: permitir llamadas desde otros dominios (ej: sabmctravel.com)
  res.setHeader("Access-Control-Allow-Origin", "*"); // si quieres, luego lo cambias a tu dominio
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Responder a preflight (OPTIONS)
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
      .json({ error: "Configuración del servidor incompleta: falta OPENAI_API_KEY" });
  }

  if (!ASSISTANT_ID) {
    console.error("Falta la variable de entorno ASSISTANT_ID");
    return res
      .status(500)
      .json({ error: "Configuración del servidor incompleta: falta ASSISTANT_ID" });
  }

  const client = new OpenAI({ apiKey });

  try {
    const { messages, threadId } = req.body;

    let thread;

    if (threadId) {
      // Recuperar hilo existente y añadir nuevo mensaje de usuario
      thread = await client.beta.threads.retrieve(threadId);
      await client.beta.threads.messages.create(thread.id, {
        role: "user",
        content: messages[messages.length - 1].content,
      });
    } else {
      // Crear hilo nuevo
      thread = await client.beta.threads.create({
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
    }

    // Ejecutar el Assistant
    await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    // Leer la última respuesta del Assistant
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
      .json({ error: "Error hablando con el travel agent" });
  }
}
