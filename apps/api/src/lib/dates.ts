// dates travel as YYYY-MM-DD strings, prisma wants a Date at utc midnight
export const parseDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

export const formatDate = (d: Date): string => d.toISOString().slice(0, 10);

// today is the utc date until company service gives us a timezone
export const todayUtc = (): string => formatDate(new Date());