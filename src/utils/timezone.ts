import { zonedTimeToUtc, utcToZonedTime, format } from 'date-fns-tz';

export const COOK_ISLANDS_TIMEZONE = 'Pacific/Rarotonga'; // UTC-10

export class TimezoneHelper {
  private timezone: string;

  constructor(timezone: string = COOK_ISLANDS_TIMEZONE) {
    this.timezone = timezone;
  }

  convertUtcToLocal(utcDate: Date): Date {
    return utcToZonedTime(utcDate, this.timezone);
  }

  convertLocalToUtc(localDate: Date): Date {
    return zonedTimeToUtc(localDate, this.timezone);
  }

  formatLocalTime(date: Date, formatString: string = 'yyyy-MM-dd HH:mm:ss zzz'): string {
    const localTime = this.convertUtcToLocal(date);
    return format(localTime, formatString, { timeZone: this.timezone });
  }

  parseNoaaTime(timeString: string): Date {
    // NOAA times are in format: "2025-09-14 12:30"
    // We need to parse this as UTC and convert to local timezone
    const utcDate = new Date(`${timeString}Z`); // Add Z to indicate UTC
    return utcDate;
  }

  isHighTideTime(currentTime: Date, tideTime: Date, advanceMinutes: number): boolean {
    const notificationTime = new Date(tideTime.getTime() - (advanceMinutes * 60 * 1000));
    const timeWindow = 5 * 60 * 1000; // 5 minute window

    return Math.abs(currentTime.getTime() - notificationTime.getTime()) <= timeWindow;
  }

  isTideTimeNow(currentTime: Date, tideTime: Date): boolean {
    const timeWindow = 2 * 60 * 1000; // 2 minute window around actual tide time

    return Math.abs(currentTime.getTime() - tideTime.getTime()) <= timeWindow;
  }

  getTimeUntilTide(tideTime: Date): { hours: number; minutes: number } {
    const now = new Date();
    const diffMs = tideTime.getTime() - now.getTime();

    if (diffMs <= 0) {
      return { hours: 0, minutes: 0 };
    }

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return { hours, minutes };
  }

  formatDuration(hours: number, minutes: number): string {
    if (hours === 0) {
      return `${minutes}m`;
    }
    if (minutes === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${minutes}m`;
  }
}