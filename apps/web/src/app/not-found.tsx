import Link from "next/link";

export default function NotFound() {
  return (
    <div className="store-page">
      <h1 className="store-display sm">Lost in the catalog</h1>
      <p className="store-lede">That page is not a listing.</p>
      <Link href="/" className="store-btn-primary">
        Back to catalog
      </Link>
    </div>
  );
}
