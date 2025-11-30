import OpenAI from "openai";

// El ASSISTANT_ID se lee desde las variables de entorno de Vercel
const ASSISTANT_ID = process.env.ASSISTANT_ID;

export default async function handler(req, res) {
  // Solo aceptamos POST; cualquier otra cosa devuelve 405
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  // Leemos la API key desde las variables de entorno
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

  // Creamos el cliente SOLO cuando ya tenemos la API key
  const client = new OpenAI({ apiKey });

  try {
    const { messages, threadId } = req.body;

    let thread;

    if (threadId) {
      // Recuperamos el hilo existente y añadimos el nuevo mensaje del usuario
      thread = await client.beta.threads.retrieve(threadId);
      await client.beta.threads.messages.create(thread.id, {
        role: "user",
        content: messages[messages.length - 1].content,
      });
    } else {
      // Creamos un hilo nuevo con el primer mensaje
      thread = await client.beta.threads.create({
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
    }

    // Ejecutamos el Assistant
    await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    // Leemos la última respuesta del Assistant
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
