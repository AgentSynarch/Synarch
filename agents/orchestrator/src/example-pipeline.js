module.exports = {
  name: "example-pipeline",
  description: "Fetches data, transforms it, and logs the output",
  steps: [
    {
      id: "fetch-data",
      type: "http-source",
      config: { url: "https://httpbin.org/json", method: "GET" },
    },
    {
      id: "extract",
      type: "transform",
      config: { script: "(data) => data.slideshow" },
    },
    {
      id: "add-metadata",
      type: "transform",
      config: {
        script: "(data) => ({ ...data, processed_at: new Date().toISOString(), agent: 'synarch-orchestrator' })",
      },
    },
    {
      id: "validate",
      type: "assert",
      config: {
        test: "(data) => data.title && data.slides",
        message: "Missing required fields: title and slides",
      },
    },
    {
      id: "output",
      type: "log",
      config: {},
    },
  ],
};
