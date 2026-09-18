"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { sha256File } from "@/lib/hash";
import {
  caricaControfirmaAccordo,
  inviaAccordoFirmatoPerEmail,
  preparaUploadControfirma,
  rivalutaAccordoConIA,
  verificaManualeAccordo,
  chiediRicaricamentoAccordo,
  mettiInCodaPecDeposito,
} from "@/app/actions-profilo";

export type RigaAccordoDaApprovare = {
  id: string;
  full_name: string | null;
  email: string;
  accordo_caricato_at: string | null;
  accordo_verificato: string | null;
  accordo_verifica_note: string | null;
  /** Impronta del documento caricato: è così che si riconosce la sua PEC. */
  accordo_sha256: string | null;
  /** Se valorizzata, la ricarica è già stata chiesta (0140): quando e perché. */
  accordo_ricarica_richiesta_at: string | null;
  accordo_ricarica_motivo: string | null;
};

/**
 * Una riga della coda PEC (0139) che riguarda un deposito di accordo: serve a
 * sapere se quel documento ha già la sua PEC, così il pulsante per rimetterla
 * in coda non compare quando non serve più.
 */
export type RigaPecDeposito = {
  stato: string;
  inviata_at: string | null;
  ultimo_errore: string | null;
  allegati: { sha256?: string }[] | null;
};

/**
 * Le righe di coda che riguardano QUEL documento (stessa impronta SHA-256),
 * dalla più recente: una persona può aver accodato la PEC più volte nella sua
 * storia, e conta l'ultima cosa che è successo.
 */
function righeDelDocumento(righe: RigaPecDeposito[] | undefined, sha256: string | null) {
  if (!sha256) return [];
  return (righe ?? []).filter((r) => (r.allegati ?? []).some((a) => a.sha256 === sha256));
}

/**
 * La PEC che conta davvero per quel documento: in coda (parte da sola) o già
 * spedita. Una riga annullata NON è una PEC data, e nemmeno una in errore: in
 * quei due casi il documento resta non certificato, e il pulsante deve restare
 * a disposizione — è il caso di Marianna, i cui unici tentativi sono le righe
 * annullate dei collaudi.
 */
function pecDelDocumento(righe: RigaPecDeposito[] | undefined, sha256: string | null) {
  return (
    righeDelDocumento(righe, sha256).find((r) => r.stato === "in_coda" || r.stato === "inviata") ??
    null
  );
}

/** L'ultimo tentativo andato a vuoto (in errore o annullato), se c'è. */
function tentativoAmmortato(righe: RigaPecDeposito[] | undefined, sha256: string | null) {
  return (
    righeDelDocumento(righe, sha256).find((r) => r.stato !== "in_coda" && r.stato !== "inviata") ??
    null
  );
}

/**
 * Il pulsante serve solo per un documento ACCETTATO (esito "ok", anche quando
 * l'accettazione è una verifica a mano) e senza una PEC vera: con data certa si
 * certifica solo quello che si è deciso di accettare. Un documento che il
 * controllo automatico ha scartato non entra in coda — prima si accetta o si
 * chiede alla persona di ricaricarlo. Se una PEC c'è già (in coda o spedita) la
 * riga lo dice, e il pulsante non deve sembrare che serva ancora.
 */
function servePulsanteDeposito(
  righe: RigaPecDeposito[] | undefined,
  sha256: string | null,
  verificato: string | null,
) {
  if (verificato !== "ok") return false;
  return !pecDelDocumento(righe, sha256);
}

/**
 * Che fine ha fatto la PEC del deposito di un documento: in coda, spedita (con
 * la data), oppure l'ultimo tentativo andato a vuoto (in errore: col motivo;
 * annullato: senza PEC, quindi si può rimettere in coda). Se non c'è niente da
 * dire, non dice niente e resta il pulsante.
 */
function StatoPecDeposito({
  deposito,
  tentativo,
}: {
  deposito: RigaPecDeposito | null;
  tentativo: RigaPecDeposito | null;
}) {
  if (deposito?.stato === "in_coda") {
    return (
      <p className="mt-1 text-xs text-emerald-700">
        PEC del deposito in coda: parte da sola entro pochi minuti.
      </p>
    );
  }
  if (deposito?.stato === "inviata") {
    return (
      <p className="mt-1 text-xs text-emerald-700">
        PEC del deposito spedita il{" "}
        {deposito.inviata_at
          ? new Date(deposito.inviata_at).toLocaleString("it-IT")
          : "(data non registrata)"}
        .
      </p>
    );
  }
  if (deposito) return null;
  if (tentativo?.stato === "errore") {
    return (
      <p className="mt-1 text-xs text-red-700">
        La PEC del deposito è ferma in errore: {tentativo.ultimo_errore ?? "motivo non registrato"}.
        Il documento non risulta certificato: si può rimettere in coda da qui.
      </p>
    );
  }
  if (tentativo?.stato === "annullata") {
    return (
      <p className="mt-1 text-xs text-slate-500">
        Un tentativo precedente è stato annullato: il documento non è certificato.
      </p>
    );
  }
  return null;
}

/**
 * Stessa riga della coda, ma per chi non ha (ancora) un esito IA 'ok': i
 * campi letti dallo schermo sono identici, cambia solo cosa si può fare —
 * rifare la verifica, o farsi mandare il PDF per la controfirma a mano.
 */
export type RigaAccordoDaRivalutare = RigaAccordoDaApprovare;

/**
 * Sezione admin "Accordi da approvare": coda dei collaboratori che hanno
 * caricato l'accordo, confermato la lettura e superato la verifica IA, e
 * attendono che il Titolare carichi la scansione della copia controfirmata
 * a mano (entrambe le firme) — quarta condizione per sbloccare l'accesso
 * ai progetti. Non basta ancora: manca la quinta, la conferma del
 * Collaboratore che è lo stesso documento che ha firmato (sezione dedicata
 * in ProfiloPersonale.tsx), che sola genera il Modulo di nomina.
 *
 * Attenzione: se l'esito IA è 'attenzione'/'errato' il profilo non appare
 * qui (la coda filtra solo esito='ok') — ma per sicurezza mostriamo la
 * nota e un avviso se per qualsiasi motivo l'esito non è ok.
 *
 * Sotto la coda c'è il blocco di chi ha caricato ma non ha un esito 'ok' (il
 * caso vero: verifica mai eseguita perché la chiave dell'IA non era
 * configurata sul server). Da lì si rifà la verifica — senza chiedere alla
 * persona di ricaricare un documento che è già a posto — e ci si fa mandare
 * per email la copia firmata che serve per la controfirma a mano.
 */
/** La nota sullo stato della PEC del deposito, per un documento (usata in entrambe le liste). */
function NotaPecDeposito({
  righe,
  sha256,
}: {
  righe?: RigaPecDeposito[];
  sha256: string | null;
}) {
  return (
    <StatoPecDeposito
      deposito={pecDelDocumento(righe, sha256)}
      tentativo={tentativoAmmortato(righe, sha256)}
    />
  );
}

/**
 * La conferma prima di rimettere in coda la PEC di un deposito: la frase è
 * obbligatoria e resta nel registro, perché si certifica con data certa solo un
 * documento che qualcuno ha guardato. Sta qui e non dentro le due liste perché
 * la cosa è identica in entrambe.
 */
function PannelloConfermaDeposito({
  nome,
  conferma,
  setConferma,
  onAnnulla,
  onInvia,
  inCorso,
}: {
  nome: string;
  conferma: string;
  setConferma: (v: string) => void;
  onAnnulla: () => void;
  onInvia: () => void;
  inCorso: boolean;
}) {
  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3">
      <label className="text-xs font-medium text-slate-700">
        Che cosa hai controllato nel documento di {nome}? La frase resta nel registro insieme al tuo
        nome: la PEC dà data certa a quello che c&apos;è nel file, quindi si manda solo dopo averlo
        guardato.
      </label>
      <textarea
        value={conferma}
        onChange={(e) => setConferma(e.target.value)}
        rows={2}
        className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        placeholder="es. guardato tutto il PDF: nove pagine, firma manoscritta in fondo, dati anagrafici presenti…"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={onAnnulla}
          className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          Annulla
        </button>
        <button
          onClick={onInvia}
          disabled={inCorso}
          className="tt-btn bg-slate-700 px-3 py-1.5 text-xs text-white hover:brightness-95 disabled:opacity-50"
        >
          {inCorso ? "Accodo…" : "Metti la PEC in coda"}
        </button>
      </div>
    </div>
  );
}

export default function AccordiDaApprovare({
  accordi,
  daRivalutare = [],
  pecDeposito = [],
}: {
  accordi: RigaAccordoDaApprovare[];
  daRivalutare?: RigaAccordoDaRivalutare[];
  /** La coda PEC dei depositi: dice quali documenti hanno già la loro PEC. */
  pecDeposito?: RigaPecDeposito[];
}) {
  const router = useRouter();
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [inVerificaManuale, setInVerificaManuale] = useState<string | null>(null);
  const [motivoVerifica, setMotivoVerifica] = useState("");
  const [inRicarica, setInRicarica] = useState<string | null>(null);
  const [motivoRicarica, setMotivoRicarica] = useState("");
  const [inDeposito, setInDeposito] = useState<string | null>(null);
  const [confermaDeposito, setConfermaDeposito] = useState("");

  async function caricaControfirma(userId: string, file: File) {
    setInCorso(userId);
    setMessaggio(null);
    try {
      const sha = await sha256File(file);

      // Il cookie di sessione è HttpOnly: il browser non può più autenticarsi
      // da solo con Storage. L'URL firmato dal server vale una volta sola,
      // solo per questo path — non serve altro per caricare.
      const prep = await preparaUploadControfirma(userId, file.name);
      if (!prep.ok) throw new Error(prep.errore);

      const { error: eUpload } = await supabaseBrowser()
        .storage.from(prep.dati.bucket)
        .uploadToSignedUrl(prep.dati.path, prep.dati.token, file, {
          contentType: file.type || "application/pdf",
        });
      if (eUpload) throw new Error(eUpload.message);

      const esito = await caricaControfirmaAccordo(userId, prep.dati.path, sha);
      if (!esito.ok) throw new Error(esito.errore);

      setMessaggio(
        "Controfirma caricata: la PEC con il documento controfirmato è in coda e partirà al prossimo invio dal computer (npm run pec -- --esegui). L'accesso ai progetti resta bloccato finché la persona non conferma, dal proprio profilo, che è lo stesso documento che ha firmato.",
      );
      router.refresh();
    } catch (e) {
      setMessaggio(`Errore: ${e instanceof Error ? e.message : "upload fallito"}`);
    } finally {
      setInCorso(null);
      const input = inputRefs.current[userId];
      if (input) input.value = "";
    }
  }

  /** Rifa la verifica IA sul documento già caricato: nessun nuovo upload. */
  async function rivaluta(userId: string) {
    setInCorso(`ia:${userId}`);
    setMessaggio(null);
    const esito = await rivalutaAccordoConIA(userId);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio(
      `Verifica rifatta, esito: ${esito.dati.esito}` +
        (esito.dati.note ? ` — ${esito.dati.note}` : "") +
        (esito.dati.esito === "ok"
          ? ". L'accordo è ora in coda: carica la copia controfirmata a mano."
          : ". Un accordo entra in coda solo con esito ok: controlla il documento o il modello caricato."),
    );
    router.refresh();
  }

  /** Manda al Titolare che chiede la copia firmata, per la controfirma a mano. */
  async function inviaCopia(userId: string) {
    setInCorso(`email:${userId}`);
    setMessaggio(null);
    const esito = await inviaAccordoFirmatoPerEmail(userId);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setMessaggio(
      `Accordo firmato inviato a ${esito.dati.destinatario}: in allegato c'è il PDF da stampare, firmare e scansionare.`,
    );
    router.refresh();
  }

  /**
   * Il controllo a mano dell'accesso globale, quando il controllo automatico
   * non è disponibile: il motivo è obbligatorio e resta nel registro.
   */
  async function confermaVerificaManuale(userId: string) {
    setInCorso(`mano:${userId}`);
    setMessaggio(null);
    const esito = await verificaManualeAccordo(userId, motivoVerifica);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setInVerificaManuale(null);
    setMotivoVerifica("");
    setMessaggio(
      "Verifica a mano registrata: l'accordo è ora in coda. Il motivo resta scritto nel Registro insieme al tuo nome.",
    );
    router.refresh();
  }

  /**
   * Chiede alla persona di ricaricare l'accordo. Il motivo è obbligatorio: lo
   * legge lei nel proprio profilo (e riceve un'email), e resta nel registro
   * insieme al tuo nome. La richiesta si chiude da sola quando arriva un
   * accordo nuovo.
   */
  async function chiediRicarica(userId: string, nome: string) {
    setInCorso(`ricarica:${userId}`);
    setMessaggio(null);
    const esito = await chiediRicaricamentoAccordo(userId, motivoRicarica);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setInRicarica(null);
    setMotivoRicarica("");
    setMessaggio(
      esito.dati.emailPartita
        ? "Richiesta inviata: la persona la trova nel proprio profilo e ha ricevuto un'email. Si chiude da sola quando carica un accordo nuovo."
        : `Richiesta registrata, ma l'EMAIL NON È PARTITA: ${nome} non sa ancora niente. Avvisala in un altro modo (o controlla la casella del progetto).`,
    );
    router.refresh();
  }

  /**
   * Rimette in coda la PEC del deposito (l'accordo firmato che la persona ha
   * caricato): la firma di chi è passato durante il blocco di Aruba non ha data
   * certa. La conferma è obbligatoria: si certifica solo un documento guardato.
   */
  async function mettiInCodaDeposito(userId: string) {
    setInCorso(`deposito:${userId}`);
    setMessaggio(null);
    const esito = await mettiInCodaPecDeposito(userId, confermaDeposito);
    setInCorso(null);
    if (!esito.ok) {
      setMessaggio(`Errore: ${esito.errore}`);
      return;
    }
    setInDeposito(null);
    setConfermaDeposito("");
    setMessaggio(
      esito.dati.giaFatta
        ? "Quel documento ha già la sua PEC (in coda o spedita): non ne ho accodata un'altra."
        : "PEC messa in coda: partirà da sola entro pochi minuti (la spedisce l'attività sul computer). La copia va alla persona.",
    );
    router.refresh();
  }

  if (accordi.length === 0 && daRivalutare.length === 0) {
    return (
      <section className="tt-card p-4 md:p-6">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Accordi da approvare</h2>
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Nessun accordo in attesa di approvazione e nessuna verifica da rifare. ✅
        </p>
      </section>
    );
  }

  return (
    <section className="tt-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Accordi da approvare</h2>
          <p className="mt-1 text-xs text-slate-400">
            Collaboratori che hanno caricato l&apos;accordo, confermato la lettura e
            superato la verifica IA: carica qui la scansione della copia cartacea
            controfirmata a mano (entrambe le firme). Manca comunque la conferma
            del collaboratore prima che l&apos;accesso si sblocchi davvero. Se la
            PEC del suo deposito non è mai partita (è successo durante il blocco di
            Aruba), qui c&apos;è anche &quot;Metti in coda la PEC del deposito&quot;: la
            rimanda sullo stesso documento che ha caricato. Su un accordo non
            ancora accettato quel pulsante non compare: prima si accetta.
          </p>
        </div>
        <span className="rounded-full bg-[#fef3e2] px-[11px] py-[3px] text-xs font-semibold text-amber-700">
          {accordi.length} in attesa
        </span>
      </div>

      {messaggio && (
        <p className="sticky top-2 z-20 mt-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-sm text-slate-700 shadow-sm backdrop-blur">
          {messaggio}
        </p>
      )}

      {accordi.length === 0 && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Nessun accordo con verifica superata in attesa di controfirma.
        </p>
      )}

      {daRivalutare.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <p className="text-[13px] font-semibold text-amber-900">
            Verifica IA non riuscita ({daRivalutare.length})
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Hanno caricato l&apos;accordo firmato, ma l&apos;esito del controllo automatico non
            è &quot;ok&quot;: per questo non entrano nella coda qui sotto. Prima di chiedere di
            ricaricare, guarda la nota: se il controllo è caduto per conto suo (servizio
            sovraccarico, chiave non configurata) il documento è già qui e basta rifare il
            controllo — se invece dice che il documento è incompleto, illeggibile o non
            firmato, allora serve il documento giusto. &quot;Mandami il PDF&quot; spedisce a
            te la copia firmata, che serve per la controfirma a mano.
          </p>
          <div className="mt-3 space-y-2">
            {daRivalutare.map((a) => (
              <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                {/* Informazione sopra, pulsanti sotto — sempre, per ogni riga:
                    con cinque pulsanti affiancati il testo restava schiacciato in
                    una striscia stretta a sinistra, e la loro posizione cambiava
                    da riga a riga a seconda di quanto era lungo il testo. */}
                <div className="space-y-3">
                  <div className="min-w-0">
                    <p className="font-medium">{a.full_name ?? "—"}</p>
                    <p className="text-xs text-slate-500">{a.email}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Caricato il{" "}
                      {a.accordo_caricato_at
                        ? new Date(a.accordo_caricato_at).toLocaleDateString("it-IT")
                        : "—"}
                    </p>
                    <p className="mt-1 text-xs text-amber-800">
                      <strong>IA: {a.accordo_verificato ?? "mai eseguita"}</strong>
                      {a.accordo_verifica_note ? ` — ${a.accordo_verifica_note}` : ""}
                    </p>
                    {a.accordo_ricarica_richiesta_at && (
                      <p className="mt-1 text-xs text-slate-600">
                        Ricarica già chiesta il{" "}
                        {new Date(a.accordo_ricarica_richiesta_at).toLocaleDateString("it-IT")}
                        {a.accordo_ricarica_motivo ? ` — «${a.accordo_ricarica_motivo}»` : ""}
                      </p>
                    )}
                    <NotaPecDeposito righe={pecDeposito} sha256={a.accordo_sha256} />
                    {/* Qui NON c'è "Metti in coda la PEC del deposito": si
                        certifica con data certa solo un documento accettato, e
                        questi non lo sono (esito IA non "ok"). Appena lo si
                        accetta — anche a mano — la riga passa fra gli accordi da
                        approvare, e il pulsante è là. */}
                    <p className="mt-1 text-xs text-slate-400">
                      La PEC del deposito si mette in coda dopo l&apos;accettazione: qui
                      l&apos;accordo non è ancora accettato.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => inviaCopia(a.id)}
                      disabled={inCorso === `email:${a.id}`}
                      className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {inCorso === `email:${a.id}` ? "Invio…" : "Mandami il PDF"}
                    </button>
                    <button
                      onClick={() => rivaluta(a.id)}
                      disabled={inCorso === `ia:${a.id}`}
                      className="tt-btn bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {inCorso === `ia:${a.id}` ? "Controllo… (può richiedere un minuto)" : "Rivaluta con l'IA"}
                    </button>
                    <button
                      onClick={() => {
                        setInVerificaManuale(a.id);
                        setMotivoVerifica("");
                      }}
                      disabled={inCorso === `mano:${a.id}`}
                      className="tt-btn border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                    >
                      Verifica tu, a mano
                    </button>
                    <button
                      onClick={() => {
                        setInRicarica(a.id);
                        setMotivoRicarica("");
                      }}
                      disabled={inCorso === `ricarica:${a.id}`}
                      className="tt-btn border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Chiedi di ricaricare
                    </button>
                  </div>
                </div>

                {inVerificaManuale === a.id && (
                  <div className="mt-3 rounded-lg bg-amber-50 p-3">
                    <label className="text-xs font-medium text-amber-900">
                      Che cosa hai controllato nel PDF di {a.full_name ?? a.email}? Resta nel
                      Registro come tua firma sul controllo — non è un automatismo.
                    </label>
                    <textarea
                      value={motivoVerifica}
                      onChange={(e) => setMotivoVerifica(e.target.value)}
                      rows={2}
                      className="mt-1.5 w-full rounded-lg border border-amber-200 px-3 py-2 text-sm"
                      placeholder="es. confrontato clausola per clausola col modello, firma manoscritta presente in fondo a pagina 4…"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => setInVerificaManuale(null)}
                        className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        Annulla
                      </button>
                      <button
                        onClick={() => confermaVerificaManuale(a.id)}
                        disabled={inCorso === `mano:${a.id}`}
                        className="tt-btn bg-amber-700 px-3 py-1.5 text-xs text-white hover:brightness-95 disabled:opacity-50"
                      >
                        {inCorso === `mano:${a.id}` ? "Registro…" : "Registra la mia verifica"}
                      </button>
                    </div>
                  </div>
                )}

                {inRicarica === a.id && (
                  <div className="mt-3 rounded-lg bg-slate-50 p-3">
                    <label className="text-xs font-medium text-slate-700">
                      Che cosa deve correggere {a.full_name ?? a.email}? Il motivo le arriva per
                      email e lo legge nel proprio profilo: scrivi che cosa manca nel documento,
                      non un giudizio. Resta nel registro insieme al tuo nome.
                    </label>
                    <textarea
                      value={motivoRicarica}
                      onChange={(e) => setMotivoRicarica(e.target.value)}
                      rows={2}
                      className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      placeholder="es. il PDF ha una pagina sola su nove: serve la scansione completa, con la firma in fondo all'ultima pagina…"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => setInRicarica(null)}
                        className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        Annulla
                      </button>
                      <button
                        onClick={() => chiediRicarica(a.id, a.full_name ?? a.email)}
                        disabled={inCorso === `ricarica:${a.id}`}
                        className="tt-btn bg-slate-700 px-3 py-1.5 text-xs text-white hover:brightness-95 disabled:opacity-50"
                      >
                        {inCorso === `ricarica:${a.id}` ? "Invio…" : "Chiedi il ricaricamento"}
                      </button>
                    </div>
                  </div>
                )}

                {inDeposito === a.id && (
                  <PannelloConfermaDeposito
                    nome={a.full_name ?? a.email}
                    conferma={confermaDeposito}
                    setConferma={setConfermaDeposito}
                    onAnnulla={() => setInDeposito(null)}
                    onInvia={() => mettiInCodaDeposito(a.id)}
                    inCorso={inCorso === `deposito:${a.id}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {accordi.map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            {/* Come sopra: informazione sopra, pulsanti sotto, per ogni riga. */}
            <div className="space-y-3">
              <div className="min-w-0">
                <p className="font-medium">{a.full_name ?? "—"}</p>
                <p className="text-xs text-slate-500">{a.email}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Caricato il{" "}
                  {a.accordo_caricato_at
                    ? new Date(a.accordo_caricato_at).toLocaleDateString("it-IT")
                    : "—"}
                </p>
                {a.accordo_verificato && (
                  <p
                    className={`mt-1 text-xs ${
                      a.accordo_verificato === "ok"
                        ? "text-emerald-700"
                        : "text-amber-800"
                    }`}
                  >
                    <strong>IA: {a.accordo_verificato}</strong>
                    {a.accordo_verifica_note ? ` — ${a.accordo_verifica_note}` : ""}
                  </p>
                )}
                {a.accordo_ricarica_richiesta_at && (
                  <p className="mt-1 text-xs text-slate-600">
                    Ricarica già chiesta il{" "}
                    {new Date(a.accordo_ricarica_richiesta_at).toLocaleDateString("it-IT")}
                    {a.accordo_ricarica_motivo ? ` — «${a.accordo_ricarica_motivo}»` : ""}
                  </p>
                )}
                {a.accordo_verificato !== "ok" && (
                  <p className="mt-1 text-xs text-red-600">
                    ⚠️ Esito IA non &quot;ok&quot;: controlla con particolare attenzione
                    prima di caricare la controfirma.
                  </p>
                )}
                <NotaPecDeposito righe={pecDeposito} sha256={a.accordo_sha256} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  ref={(el) => {
                    inputRefs.current[a.id] = el;
                  }}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void caricaControfirma(a.id, file);
                  }}
                />
                <button
                  onClick={() => inviaCopia(a.id)}
                  disabled={inCorso === `email:${a.id}`}
                  className="tt-btn border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {inCorso === `email:${a.id}` ? "Invio…" : "Mandami il PDF"}
                </button>
                {servePulsanteDeposito(pecDeposito, a.accordo_sha256, a.accordo_verificato) && (
                  <button
                    onClick={() => {
                      setInDeposito(a.id);
                      setConfermaDeposito("");
                    }}
                    disabled={inCorso === `deposito:${a.id}`}
                    className="tt-btn border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Metti in coda la PEC del deposito
                  </button>
                )}
                <button
                  onClick={() => inputRefs.current[a.id]?.click()}
                  disabled={inCorso === a.id}
                  className="tt-btn bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {inCorso === a.id ? "Carico…" : "Carica controfirma"}
                </button>
              </div>
            </div>

            {inDeposito === a.id && (
              <PannelloConfermaDeposito
                nome={a.full_name ?? a.email}
                conferma={confermaDeposito}
                setConferma={setConfermaDeposito}
                onAnnulla={() => setInDeposito(null)}
                onInvia={() => mettiInCodaDeposito(a.id)}
                inCorso={inCorso === `deposito:${a.id}`}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
