import fastify from "fastify";

// Create a Fastify server instance
const app = fastify({ logger: true });

// Define a simple health check endpoint
app.get("/health", async () => {
  return { status: "ok" };
});

// Define a greeting endpoint
app.get("/api/greet", async () => {
  return { message: "Hello from Fastify!" };
});

// Start the server
const start = async () => {
  try {
    await app.listen({ port: 3000, host: "0.0.0.0" });
    console.log("Server is running on http://localhost:3000");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
