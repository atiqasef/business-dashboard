/** Hours before another manual reminder can be sent for the same invoice. */
export const MANUAL_REMINDER_COOLDOWN_HOURS = 1;

/** Days before another automated reminder of the same type can be sent for an invoice. */
export const AUTOMATED_REMINDER_COOLDOWN_DAYS = 7;

/** Invoices due within this many days are eligible for due-soon reminders. */
export const DUE_SOON_WINDOW_DAYS = 3;

/** Max invoices processed per cron invocation. */
export const REMINDER_CRON_BATCH_LIMIT = 25;

export const DEFAULT_REMINDER_PAGE_SIZE = 20;
export const MAX_REMINDER_PAGE_SIZE = 100;
