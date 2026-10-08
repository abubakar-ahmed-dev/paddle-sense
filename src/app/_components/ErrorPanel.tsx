"use client";

export default function ErrorPanel({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/50 bg-danger-deep/40 p-3 text-sm text-silt"
    >
      <p>{message}</p>
      {retry && (
        <button
          onClick={retry}
          className="mt-2 rounded-md border border-danger/50 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/10"
        >
          Try again
        </button>
      )}
    </div>
  );
}
