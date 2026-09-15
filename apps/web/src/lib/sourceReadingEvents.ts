export const SOURCE_READING_CHANGED = "interleave:source-reading-changed";

export function sourceReadingChanged(sourceId: string): void {
  window.dispatchEvent(new CustomEvent(SOURCE_READING_CHANGED, { detail: sourceId }));
}

export function listenSourceReading(sourceId: string, callback: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === sourceId) callback();
  };
  window.addEventListener(SOURCE_READING_CHANGED, listener);
  return () => window.removeEventListener(SOURCE_READING_CHANGED, listener);
}

export async function withSourceReadingChange<T>(sourceId: string, result: Promise<T>): Promise<T> {
  const value = await result;
  sourceReadingChanged(sourceId);
  return value;
}
