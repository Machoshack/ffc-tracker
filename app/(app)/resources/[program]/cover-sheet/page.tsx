import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function CoverSheetPage({ params }: { params: Promise<{ program: string }> }) {
  if ((await params).program !== 'FHE') notFound();
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <Link href="/resources/FHE" className="text-muted hover:text-brand">← FHE resources</Link>
        <span className="text-muted">
          Nothing typed here is saved. Use the button at the bottom left to print or save as PDF.{' '}
          <a href="/tools/fhe-cover-sheet.html" target="_blank" rel="noopener" className="text-brand underline">Open in its own tab</a>
        </span>
      </div>
      <iframe src="/tools/fhe-cover-sheet.html" title="FHE cover sheet generator"
        className="h-[calc(100vh-11rem)] min-h-[600px] w-full rounded border border-line bg-white" />
    </div>
  );
}
