import { createMailer } from '@nexzi/server-core';
import { config } from './config';

export const mailer = createMailer(config);