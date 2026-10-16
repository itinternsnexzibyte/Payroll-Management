'use client';
import { ErrorScreen } from '@nexzi/ui';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <ErrorScreen reset={reset} />;
}
