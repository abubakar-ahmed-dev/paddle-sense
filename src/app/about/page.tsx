import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About the data — PaddleSense",
  description:
    "What GloFAS is, what a grid cell is, how runnable ranges get verified, and what this app refuses to claim.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">About the data</h1>
        <p className="mt-2 text-sm text-silt-dim">
          What this app knows, where that knowledge comes from, and — just as
          important — what it refuses to claim.
        </p>
      </header>

      <section>
        <h2 className="text-xl font-semibold">What GloFAS is</h2>
        <p className="mt-2 text-sm leading-relaxed text-silt-dim">
          Every number on this site comes from the{" "}
          <a
            className="text-ochre hover:text-ochre-deep"
            href="https://global-flood-database.ecmwf.int"
            target="_blank"
            rel="noopener noreferrer"
          >
            Global Flood Awareness System (GloFAS)
          </a>{" "}
          — Copernicus and ECMWF&apos;s global hydrological model, served free
          by the Open-Meteo Flood API. GloFAS simulates every river on Earth on
          a ~5 km grid and produces daily discharge (m³/s) plus a 30-day
          forecast.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">What a grid cell is</h2>
        <p className="mt-2 text-sm leading-relaxed text-silt-dim">
          GloFAS is a model, not a gauge. Each value describes a ~5 km square of
          land, and narrow valleys can be missed or averaged away. Every card
          shows the exact cell coordinates and elevation it uses. For example,
          our Skardu-area cells resolved poorly, so the Indus is tracked where
          the model represents it best — the Besham stretch on the Karakoram
          Highway — and the UI says so. Grid-cell estimates are not gauge
          measurements.
        </p>
      </section>

      <section id="ranges">
        <h2 className="text-xl font-semibold">
          How &ldquo;runnable range&rdquo; gets verified
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-silt-dim">
          A runnable range (the discharge band where a river is fun rather than
          dangerous) is only shown once it is backed by a quoted source — a
          rafting operator page, a guidebook, a trip report — with a link and a
          date. Until then the app says{" "}
          <span className="text-attention">
            &ldquo;range not yet verified&rdquo;
          </span>{" "}
          and shows the raw level. Ranges are never invented to make the UI look
          complete.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-silt-dim">
          Verification is a human decision, not an automated one. The app&apos;s
          weekly search stores what it finds as <em>candidates</em> — the exact
          quote, the source, and the date — and a person judges whether the
          source is credible before the range is promoted and shown on the
          chart. The software can find claims; only a human can upgrade one
          into a fact this app relies on. Found quotes are always shown
          verbatim, with any unit conversion (cfs → m³/s) labeled next to the
          original wording.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">What we refuse to claim</h2>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-silt-dim">
          <li>
            No green &ldquo;safe&rdquo; badge — the words{" "}
            <em>safe</em> and <em>danger-free</em> do not appear in this product.
          </li>
          <li>
            High water always says <strong>do not go</strong>. Low water says
            what it is.
          </li>
          <li>
            Predictions are bands with published error margins — never a single
            &ldquo;guaranteed&rdquo; number.
          </li>
          <li>
            The forecast must prove itself by{" "}
            <Link className="text-ochre hover:text-ochre-deep" href="/retro">
              retrodiction
            </Link>{" "}
            — predicting hidden past weeks and comparing with the record.
            Until those metrics exist, forecasts are labelled experimental.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Why the Malir is here</h2>
        <p className="mt-2 text-sm leading-relaxed text-silt-dim">
          Karachi&apos;s Malir is not a paddling river — it is an ephemeral
          channel that reads near-zero most of the year and spikes in monsoon.
          It stays in the index on purpose: when the app says{" "}
          <span className="font-mono">0.1 m³/s — not runnable</span> and the
          riverbed matches, that is the honesty check working. (Its monsoon
          spikes are also the data Karachi flood warnings need — noted here,
          not productized.)
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Open and free, on purpose</h2>
        <p className="mt-2 text-sm leading-relaxed text-silt-dim">
          PaddleSense runs entirely on free tiers and open data: GloFAS via
          Open-Meteo, Postgres + pgvector on Tiger Data, durable runs on
          Temporal, predictions via TabPFN, and an open-weight Gemma model for
          plain-language summaries. No accounts, no tracking, $0 to run — so a
          rafting operator or a club could adopt it tomorrow. The code is open;
          the model is swappable; the data sources are public.
        </p>
      </section>
    </div>
  );
}
