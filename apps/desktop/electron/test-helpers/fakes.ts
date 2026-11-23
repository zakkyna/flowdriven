export function fakeNotifier(draw: (options: { title: string; body: string }) => void) {
  return class FakeNotification {
    static isSupported() {
      return true;
    }
    constructor(options: { title: string; body: string }) {
      draw(options);
    }
    on(_event: "click" | "close", _callback: () => void) {
      return this;
    }
    show() {}
  };
}
