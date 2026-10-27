export function trustedSender(event: {
  sender: unknown; senderFrame: { url: string } | null;
}, contents: { mainFrame: unknown }, pageUrl: string): boolean {
  return event.sender === contents && event.senderFrame === contents.mainFrame
    && event.senderFrame?.url === pageUrl;
}
