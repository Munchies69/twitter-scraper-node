export {};

declare global {
  interface Window {
    chrome?: {
      runtime: {
        sendMessage: (message: any) => void;
      };
    };
  }
}