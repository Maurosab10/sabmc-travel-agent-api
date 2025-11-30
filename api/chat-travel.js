import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ASSISTANT_ID = process.env.ASSISTANT_ID;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

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

    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: ASSISTANT_ID,
    });

    const messagesResponse = await client.beta.threads.messages.list(thread.id);
    const lastMessage = messagesResponse.data[0];
    const answer = lastMessage.content[0]?.text?.value || "";

    res.status(200).json({
      threadId: thread.id,
      answer,
    });
  } catch (error) {
    console.error("Error en chat-travel:", error);
    res.status(500).json({ error: "Error hablando con el travel agent" });
  }
}
