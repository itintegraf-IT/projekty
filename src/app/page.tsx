export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center font-black text-white">
            I
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-100">
              INTEGRAF
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
              Výrobní plán
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-400">
          <span className="uppercase tracking-[0.18em]">Etapa 1</span>
          <span className="text-slate-500">Skeleton aplikace · mock data</span>
        </div>
      </header>

      <section className="flex flex-1 min-h-0">
        {/* LEVÁ ČÁST – placeholder timeline */}
        <div className="flex-1 border-r border-slate-800 bg-slate-950/60 flex flex-col min-w-0">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <div className="font-semibold tracking-wide uppercase">
              Timeline (XL 105 / XL 106)
            </div>
            <div className="flex gap-2">
              <div className="h-6 px-2 rounded-md border border-slate-700 bg-slate-900 flex items-center gap-2 text-[11px]">
                <span className="text-slate-500">Filtr</span>
                <span className="text-slate-300 font-medium">číslo zakázky</span>
              </div>
              <div className="h-6 px-2 rounded-md border border-slate-700 bg-slate-900 flex items-center gap-2 text-[11px]">
                <span className="text-slate-500">Skok na</span>
                <span className="text-slate-300 font-medium">datum</span>
              </div>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
            <div className="text-center space-y-2">
              <div className="font-semibold text-slate-300">
                Zde bude plánovací timeline
              </div>
              <p className="max-w-xs mx-auto text-[11px] text-slate-500">
                V dalších etapách sem přidáme skutečný grid po 30 minutách,
                stroje XL 105 / XL 106, drag &amp; drop a všechny stavy
                podle dokumentace.
              </p>
            </div>
          </div>
        </div>

        {/* PRAVÁ ČÁST – builder formulář (mock) */}
        <aside className="w-[320px] lg:w-[360px] bg-slate-950">
          <div className="h-full flex flex-col border-l border-slate-800">
            <div className="px-4 py-3 border-b border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Job builder
              </div>
              <div className="mt-1 text-[11px] text-slate-300">
                Vytvoř nový blok → ulož do databáze → zobraz na timeline.
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-[11px]">
              <div>
                <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                  Číslo zakázky
                </label>
                <input
                  disabled
                  className="w-full rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600"
                  placeholder="17001"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                    Stroj
                  </label>
                  <select
                    disabled
                    className="w-full rounded-md border border-slate-800 bg-slate-950/80 px-2 py-2 text-[11px] text-slate-200"
                  >
                    <option>XL 105</option>
                    <option>XL 106</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                    Délka (30 min sloty)
                  </label>
                  <select
                    disabled
                    className="w-full rounded-md border border-slate-800 bg-slate-950/80 px-2 py-2 text-[11px] text-slate-200"
                  >
                    <option>1 hod</option>
                    <option>1,5 hod</option>
                    <option>2 hod</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                  Popis zakázky
                </label>
                <textarea
                  disabled
                  rows={3}
                  className="w-full rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-600 resize-none"
                  placeholder="Firma – produkt – počet tisků…"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                    DATA
                  </label>
                  <input
                    disabled
                    type="date"
                    className="w-full rounded-md border border-slate-800 bg-slate-950/80 px-2 py-2 text-[11px] text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                    Materiál
                  </label>
                  <input
                    disabled
                    type="date"
                    className="w-full rounded-md border border-slate-800 bg-slate-950/80 px-2 py-2 text-[11px] text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold tracking-wide text-slate-400 mb-1">
                  Expedice
                </label>
                <input
                  disabled
                  type="date"
                  className="w-full rounded-md border border-slate-800 bg-slate-950/80 px-2 py-2 text-[11px] text-slate-200"
                />
              </div>

              <div className="pt-2">
                <button
                  disabled
                  className="w-full rounded-md bg-yellow-400/70 text-black font-semibold py-2 text-[11px] cursor-not-allowed"
                >
                  Uložit blok (mock) – DB přidáme v další kroku
                </button>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

