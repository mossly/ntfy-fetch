import axios from 'axios';
import { NotificationData, NtfyConfig } from '../types';
import { logger } from '../utils/logger';

export class NotificationService {
  private config: NtfyConfig;

  constructor(config: NtfyConfig) {
    this.config = config;
  }

  async sendNotification(notification: NotificationData): Promise<boolean> {
    try {
      const url = `${this.config.url}/${this.config.topic}`;

      const headers: Record<string, string> = {
        'Content-Type': 'text/plain; charset=utf-8'
      };

      if (notification.title) {
        // Clean title of problematic characters (emojis, control chars, non-ASCII)
        const cleanTitle = notification.title
          .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emojis
          .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
          .trim();
        headers['Title'] = cleanTitle || 'Notification';
      }

      if (notification.priority) {
        headers['Priority'] = notification.priority;
      }

      if (notification.tags && notification.tags.length > 0) {
        headers['Tags'] = notification.tags.join(',');
      }

      if (notification.click) {
        headers['Click'] = notification.click;
      }

      if (notification.attach) {
        headers['Attach'] = notification.attach;
      }

      if (this.config.auth) {
        if (this.config.auth.type === 'basic' && this.config.auth.username && this.config.auth.password) {
          const credentials = Buffer.from(`${this.config.auth.username}:${this.config.auth.password}`).toString('base64');
          headers['Authorization'] = `Basic ${credentials}`;
        } else if (this.config.auth.type === 'token' && this.config.auth.token) {
          headers['Authorization'] = `Bearer ${this.config.auth.token}`;
        }
      }

      logger.debug('Sending notification to ntfy', {
        url,
        title: notification.title,
        priority: notification.priority,
        tags: notification.tags
      });

      const response = await axios.post(url, notification.message, {
        headers,
        timeout: 10000, // 10 second timeout
        validateStatus: (status) => status < 500 // Accept 4xx as valid responses
      });

      if (response.status >= 400) {
        logger.warn(`ntfy returned status ${response.status}`, {
          status: response.status,
          statusText: response.statusText,
          data: response.data
        });
        return false;
      }

      logger.info('Notification sent successfully', {
        title: notification.title,
        status: response.status
      });

      return true;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED') {
          logger.error('ntfy request timeout');
        } else if (error.response) {
          logger.error('ntfy HTTP error', {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
          });
        } else if (error.request) {
          logger.error('Failed to connect to ntfy server', {
            url: this.config.url
          });
        } else {
          logger.error('ntfy request setup error', { message: error.message });
        }
      } else {
        logger.error('Unexpected error sending notification', error);
      }

      return false;
    }
  }

  async sendBulkNotifications(notifications: NotificationData[]): Promise<number> {
    let successCount = 0;

    for (const notification of notifications) {
      const success = await this.sendNotification(notification);
      if (success) {
        successCount++;
      }

      // Small delay between notifications to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info(`Sent ${successCount}/${notifications.length} notifications successfully`);

    return successCount;
  }

  async testConnection(): Promise<boolean> {
    try {
      const testNotification: NotificationData = {
        title: 'ntfy-fetch Test',
        message: 'Connection test successful! 🎉',
        priority: 'low',
        tags: ['test']
      };

      return await this.sendNotification(testNotification);
    } catch (error) {
      logger.error('Failed to test ntfy connection', error);
      return false;
    }
  }

  updateConfig(config: NtfyConfig): void {
    this.config = config;
    logger.info('NotificationService configuration updated');
  }
}