import { z } from "zod/v4";

const callbackSchema = z
  .string()
  .regex(/^http:\/\/127\.0\.0\.1:\d{1,5}\/orven-auth\/callback$/)
  .refine((value) => {
    const port = Number(/^http:\/\/127\.0\.0\.1:(\d{1,5})\//.exec(value)?.[1]);
    return port >= 1024 && port <= 65535;
  });

// Presentation only. The caller must verify the browser user and bound desktop flow.
export function confirmationPage(
  username: string,
  avatarUrl: string,
  flowId: string,
  redirectUri: string,
): Response {
  const callback = callbackSchema.safeParse(redirectUri);
  if (!callback.success)
    throw new Error("Invalid desktop callback configuration");
  // Escape at the HTML boundary, even though the caller validates these values.
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const nonce = crypto.randomUUID();
  const css = `
    :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#20242b;background:#f3f4f6}
    *{box-sizing:border-box}body{margin:0;min-height:100dvh;padding:24px}
    dialog{width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;margin:auto;padding:32px;border:1px solid #dce0e6;border-radius:16px;background:#fff;color:inherit;box-shadow:0 20px 70px #17202d26}
    dialog::backdrop{background:#18202d30}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}.brand{font-size:18px;font-weight:650;letter-spacing:-.5px}.label{font-size:12px;color:#626872}
    h1{font-size:24px;line-height:1.25;letter-spacing:-.6px;margin:0 0 10px}p{font-size:14px;line-height:1.6;margin:0;color:#454b54}.identity{display:flex;align-items:center;gap:14px;margin:24px 0;padding:16px;background:#f6f7f9;border-radius:10px;min-width:0}.avatar{position:relative;display:grid;place-items:center;font-size:16px;font-weight:600;width:48px;height:48px;border-radius:50%;background:#e2e5ea;flex-shrink:0;overflow:hidden}.avatar img[hidden]{display:none}.avatar img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}.identity strong{display:block;overflow-wrap:anywhere;font-size:15px}.identity span{display:block;font-size:12px;color:#626872;margin-top:4px}.warning{font-size:12px;margin:20px 0 24px;color:#626872}.actions{display:flex;gap:10px}.actions form{flex:1;min-width:0}button{width:100%;min-height:42px;padding:10px 14px;border:1px solid #858d99;border-radius:7px;background:#fff;color:#20242b;font-family:inherit;font-size:13px;font-weight:600;line-height:1.4;cursor:pointer;overflow-wrap:anywhere}.actions button{height:100%}.actions form:last-child{flex:1.4}button.primary{background:#244fce;border-color:#244fce;color:#fff}button:hover{filter:brightness(.96)}button:focus-visible{outline:3px solid #244fce;outline-offset:3px}#cancelled{max-width:440px;margin:20vh auto;background:#fff;border-radius:12px;padding:28px}#cancelled h1{font-size:22px}@media(max-width:400px){dialog{padding:24px}.actions{flex-direction:column}}
  `;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Orven · Confirm GitHub account</title><style nonce="${nonce}">${css}</style></head><body>
    <dialog id="confirmation" aria-labelledby="title" aria-describedby="description warning">
      <header><span class="brand">Orven</span><span class="label">GitHub account</span></header>
      <h1 id="title">Sign in to Orven Desktop</h1>
      <p id="description">Confirm the account you want to use on this computer.</p>
      <div class="identity"><div class="avatar"><span aria-hidden="true">${escape(username.slice(0, 2).toUpperCase())}</span><img src="${escape(avatarUrl)}" alt="" width="48" height="48" referrerpolicy="no-referrer"></div><div><strong>${escape(username)}</strong><span>Verified by GitHub</span></div></div>
      <p>This signs in the desktop app. It grants no repository or MCP access.</p>
      <p class="warning" id="warning">Not your account? Cancel, switch accounts on GitHub, then restart sign-in from Orven.</p>
      <div class="actions"><form method="dialog"><button type="submit">Cancel</button></form><form method="post" action="/auth/desktop/approve"><input type="hidden" name="flow_id" value="${escape(flowId)}"><button class="primary" type="submit">Continue as ${escape(username)}</button></form></div>
    </dialog>
    <main id="cancelled" hidden tabindex="-1"><h1>Sign-in not completed</h1><p>Close this tab and return to Orven to cancel or restart sign-in.</p></main>
    <noscript><p>JavaScript is required to display the confirmation dialog. Return to Orven to cancel sign-in.</p></noscript>
    <script nonce="${nonce}">const avatar=document.querySelector('.avatar img');const hideAvatar=()=>{avatar.hidden=true};avatar.addEventListener('error',hideAvatar);if(avatar.complete&&avatar.naturalWidth===0)hideAvatar();const dialog=document.getElementById('confirmation');dialog.addEventListener('close',()=>{const message=document.getElementById('cancelled');message.hidden=false;message.focus()});const approval=document.querySelector('form[action="/auth/desktop/approve"]');approval.addEventListener('submit',()=>{const button=approval.querySelector('button');button.disabled=true;button.textContent='Returning to Orven…'});dialog.showModal();</script>
  </body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // no-referrer makes navigation form POSTs send Origin:null, failing CSRF.
        // Preserve the HTTPS origin only, never a path/query or a downgrade referrer.
        "Referrer-Policy": "strict-origin",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src https://avatars.githubusercontent.com; form-action 'self' ${callback.data}; frame-ancestors 'none'; base-uri 'none'`,
      },
    },
  );
}
