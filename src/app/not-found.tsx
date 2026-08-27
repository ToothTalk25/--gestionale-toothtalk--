import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="mx-auto max-w-sm text-center">
        <img src="/logo-toothtalk.svg" alt="ToothTalk" className="mx-auto h-9 w-auto" />

        <div className="mt-6 tt-card p-8">
          <p className="text-sm font-semibold text-tt-blue">Errore 404</p>
          <h1 className="mt-2 text-xl font-semibold text-tt-ink">
            Questa pagina non esiste
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Il link potrebbe essere sbagliato o il contenuto non c&apos;è più.
          </p>

          <Link
            href="/"
            className="tt-btn mt-6 inline-block bg-tt-blue px-5 py-2.5 text-sm text-white hover:brightness-95"
          >
            Torna al gestionale
          </Link>
        </div>
      </div>
    </main>
  );
}
