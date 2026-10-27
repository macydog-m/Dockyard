// Some headless/remote Windows sessions cannot round-trip the OS clipboard.
// Opt-in payload capture still checks the IPC write text; it does not verify OS integration.
export async function smokeClipboard(app) {
  const captureOnly = process.argv.includes('--capture-clipboard');
  if (captureOnly) {
    await app.evaluate(({ clipboard }) => {
      const write = clipboard.writeText.bind(clipboard);
      globalThis.dockyardSmokeClipboard = '';
      clipboard.writeText = (text, ...args) => { globalThis.dockyardSmokeClipboard = text; return write(text, ...args); };
    });
    console.log('System clipboard verification SKIPPED (--capture-clipboard); checking IPC payloads only.');
  }
  return () => app.evaluate(({ clipboard }, captureOnly) => captureOnly ? globalThis.dockyardSmokeClipboard : clipboard.readText(), captureOnly);
}
