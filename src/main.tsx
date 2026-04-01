
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  const root = document.getElementById("root")!;

  try {
    createRoot(root).render(<App />);
  } catch (err) {
    root.innerHTML = `<div style="padding:32px;font-family:monospace;color:#ff4444;background:#0a0a0a;min-height:100vh">
      <h2 style="font-size:18px;margin-bottom:12px">启动错误 (module/init crash)</h2>
      <pre style="white-space:pre-wrap;font-size:13px;color:#ff8888">${String(err)}</pre>
    </div>`;
  }
