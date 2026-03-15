import { Link } from 'react-router-dom'
import SiteLayout from '../components/SiteLayout'

export default function LandingPage() {
  return (
    <SiteLayout>
      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 sm:pt-24 pb-20 text-center">
        <h1 className="text-4xl sm:text-5xl lg:text-[56px] font-bold leading-[1.1] mb-6 text-[#0d3d2a]">
          Ancora a stampare, firmare e scannerizzare documenti?
        </h1>
        <p className="text-xl sm:text-2xl text-gray-600 mb-4 leading-relaxed">
          Con <strong className="text-green-600">Trustera</strong> firmi e invii tutto <strong className="text-gray-900">in meno di un minuto.</strong>
        </p>
        <p className="text-base sm:text-lg text-gray-500 mb-10 leading-relaxed max-w-2xl mx-auto">
          Ogni documento ha <strong className="text-gray-700">Audit Trail certificato</strong>: data, ora, dispositivo e firma registrati.
          <br />Cosi nessuno puo modificare il documento dopo la firma.
        </p>
        <Link to="/login" className="inline-block bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-10 rounded-xl text-lg transition-all shadow-lg shadow-green-600/25 active:scale-[0.98]">
          Inizia Gratis
        </Link>
      </section>

      {/* Features */}
      <section className="bg-gray-50 py-20">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { title: 'Firma digitale.', desc: 'Firma qualsiasi documento PDF con verifica OTP.' },
              { title: 'Tracciata.', desc: 'Audit trail completo: IP, data, ora, dispositivo.' },
              { title: 'Protetta.', desc: 'Hash SHA-256, documento non modificabile dopo la firma.' },
              { title: 'Gratuita.', desc: 'Piano Free senza limiti, sostenuto da offerte partner.' },
            ].map(f => (
              <div key={f.title} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm hover:shadow-md hover:shadow-green-600/5 transition-shadow">
                <h3 className="text-lg font-bold text-green-600 mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing preview */}
      <section className="max-w-4xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-4 text-[#0d3d2a]">Scegli il tuo piano</h2>
        <p className="text-center text-gray-400 mb-12">
          <Link to="/pricing" className="hover:text-green-600 transition-colors underline underline-offset-4">Vedi tutti i dettagli</Link>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
            <h3 className="text-2xl font-bold text-green-600 mb-1">Free</h3>
            <p className="text-4xl font-bold text-gray-900 mb-1">0</p>
            <p className="text-sm text-gray-400 mb-6">per sempre</p>
            <p className="text-gray-500 text-sm mb-6 leading-relaxed">
              Piattaforma senza costo, sostenuta da iniziative promozionali e vantaggi commerciali per gli utenti che prestano consenso.
            </p>
            <ul className="text-sm text-gray-600 space-y-3 mb-8">
              {['Documenti illimitati', 'Firma OTP via WhatsApp/Email', 'Audit Trail certificato', 'Dashboard documenti'].map(item => (
                <li key={item} className="flex items-center gap-2">
                  <span className="text-green-600 font-bold text-base">&#10003;</span>
                  {item}
                </li>
              ))}
            </ul>
            <Link to="/login" className="block text-center bg-green-600 hover:bg-green-700 text-white font-bold py-3.5 rounded-lg transition-colors shadow-md shadow-green-600/20">
              Inizia Gratis
            </Link>
          </div>
          <div className="bg-white border-2 border-green-500/30 rounded-2xl p-8 relative shadow-sm">
            <div className="absolute -top-3 right-6 bg-green-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              PRO
            </div>
            <h3 className="text-2xl font-bold text-green-600 mb-1">Premium</h3>
            <p className="text-4xl font-bold text-gray-900 mb-1">--</p>
            <p className="text-sm text-gray-400 mb-6">prossimamente</p>
            <p className="text-gray-500 text-sm mb-6 leading-relaxed">
              Esperienza dedicata, senza utilizzo dei contatti per finalita promozionali di terzi.
            </p>
            <ul className="text-sm text-gray-600 space-y-3 mb-8">
              {['Tutto del Free', 'Nessuna promozione partner', 'Branding personalizzato', 'API access'].map(item => (
                <li key={item} className="flex items-center gap-2">
                  <span className="text-green-600 font-bold text-base">&#10003;</span>
                  {item}
                </li>
              ))}
            </ul>
            <button disabled className="block w-full text-center bg-gray-100 text-gray-400 font-bold py-3.5 rounded-lg cursor-not-allowed">
              Prossimamente
            </button>
          </div>
        </div>
      </section>

      {/* Trust bar */}
      <section className="bg-[#0d3d2a] py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">30 giorni gratis. Nessun rischio.</h2>
          <p className="text-green-200/70 text-lg mb-8 max-w-xl mx-auto">Prova Trustera gratuitamente e valuta la piattaforma in piena liberta. Nessuna penale, nessun vincolo.</p>
          <Link to="/login" className="inline-block bg-white text-[#0d3d2a] font-bold py-3.5 px-10 rounded-xl text-lg transition-all hover:bg-green-50 active:scale-[0.98]">
            Inizia Gratis
          </Link>
        </div>
      </section>
    </SiteLayout>
  )
}
