import { automatedTwExportly } from "./scraper-service";

interface QueueItem {
  username: string;
  sendUpdate: (update: string) => void;
}

class ScrapeQueue {
  private queue: QueueItem[] = [];
  private isProcessing: boolean = false;

  async addToQueue(
    username: string,
    sendUpdate: (update: string) => void
  ): Promise<void> {
    const position = this.queue.length + 1;
    this.queue.push({ username, sendUpdate });
    sendUpdate(`Added to queue. Current position: ${position}`);
    console.log(
      `Added ${username} to the scrape queue. Queue length: ${this.queue.length}`
    );
    this.updateQueuePositions();
    this.processQueue();
  }

  private updateQueuePositions(): void {
    this.queue.forEach((item, index) => {
      const newPosition = index + 1;
      item.sendUpdate(`Queue position updated: ${newPosition}`);
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift();

    if (!item) {
      this.isProcessing = false;
      return;
    }

    const { username, sendUpdate } = item;

    try {
      console.log(`Starting scrape for user: ${username}`);
      sendUpdate("Scraping started");
      await automatedTwExportly(username, (update) => {
        console.log(`[${username}]: ${update}`);
        sendUpdate(update);
      });
      console.log(`Finished scraping for user: ${username}`);
      sendUpdate("Scraping completed");
    } catch (error) {
      console.error(`Error scraping user ${username}:`, error);
      sendUpdate(`Error occurred during scraping: ${error.message}`);
    } finally {
      this.isProcessing = false;
      this.updateQueuePositions();
      this.processQueue(); // Process next item in the queue
    }
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getQueuePosition(username: string): number {
    return this.queue.findIndex((item) => item.username === username) + 1;
  }
}

const scrapeQueue = new ScrapeQueue();

export async function queueScrapeTask(
  username: string,
  sendUpdate: (update: string) => void
): Promise<void> {
  await scrapeQueue.addToQueue(username, sendUpdate);
}

export function getQueueStatus(): string {
  return `Current queue length: ${scrapeQueue.getQueueLength()}`;
}

export function getQueuePosition(username: string): number {
  return scrapeQueue.getQueuePosition(username);
}

export { scrapeQueue };
