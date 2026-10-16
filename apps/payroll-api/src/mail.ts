import { createLogger, createMailer } from '@nexzi/server-core';
import { config } from './config';

export const mailer = createMailer(config, createLogger('payroll-api-mail', config.LOG_LEVEL));
