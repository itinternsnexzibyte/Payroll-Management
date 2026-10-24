import { Spinner } from '@nexzi/ui';

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8" aria-busy="true">
      <Spinner label="Opening module…" />
    </div>
  );
}
