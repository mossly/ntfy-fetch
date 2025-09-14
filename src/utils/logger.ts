import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';

export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ntfy-fetch' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
        })
      )
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.File({
    filename: 'data/error.log',
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }));

  logger.add(new winston.transports.File({
    filename: 'data/combined.log',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }));
}