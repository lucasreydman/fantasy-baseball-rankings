const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const RANKINGS_PATH = path.join(__dirname, "data", "rankings.csv");

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".csv": "text/csv",
};

const server = http.createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }
  const url = req.url === "/" ? "/index.html" : req.url;
  if (url === "/data") {
    fs.readFile(RANKINGS_PATH, "utf8", (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Error loading rankings");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/csv" });
      res.end(data);
    });
    return;
  }
  const filePath = path.join(PUBLIC_DIR, path.normalize(url).replace(/^(\.\.(\/|\\|$))+/, ""));
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log("Draft assistant: http://localhost:" + PORT);
});
