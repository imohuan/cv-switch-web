const http = require("http");
const fs = require("fs");
const os = require("os");
function post(path, body, cb) {
  const data = JSON.stringify(body);
  const req = http.request("http://127.0.0.1:3121" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": data.length }
  }, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => cb(d)); });
  req.write(data);
  req.end();
}

// 1. Switch to a provider
post("/api/switch/codex/eb2d9c70-274a-4058-814b-b6f35d6ba56a", {}, r1 => {
  console.log("1. Connect:", JSON.parse(r1).message);
  let toml = fs.readFileSync(os.homedir() + "/.codex/config.toml", "utf-8");
  let top = toml.match(/^model_provider = "(.+)"/m);
  console.log("   model_provider:", top ? top[1] : "NONE");
  
  // 2. Clear (disconnect)
  post("/api/switch/codex/clear", {}, r2 => {
    console.log("2. Disconnect:", JSON.parse(r2).message);
    toml = fs.readFileSync(os.homedir() + "/.codex/config.toml", "utf-8");
    top = toml.match(/^model_provider = "(.+)"/m);
    console.log("   model_provider:", top ? top[1] : "NONE");
    // After disconnect, model_provider should be cv-switch-router (since no active provider)
    // and all providers should still be listed
    
    // 3. Reconnect with VA enabled
    post("/api/codex/virtual-account/toggle", {enabled: true}, r3 => {
      console.log("3. Enable VA:", JSON.parse(r3).message);
      post("/api/switch/codex/ccd15166-e9a5-490f-bc07-af55d586a744", {}, r4 => {
        console.log("4. Connect pixelstarrysky:", JSON.parse(r4).message);
        toml = fs.readFileSync(os.homedir() + "/.codex/config.toml", "utf-8");
        top = toml.match(/^model_provider = "(.+)"/m);
        console.log("   model_provider:", top ? top[1] : "NONE");
        // Should be cv-switch-router since VA is on
        
        // Cleanup
        post("/api/codex/virtual-account/toggle", {enabled: false}, r5 => {
          console.log("5. Cleanup:", JSON.parse(r5).message);
        });
      });
    });
  });
});
