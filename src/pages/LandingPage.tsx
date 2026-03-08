import { Link } from 'react-router-dom'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <img src="/trustera-logo.jpeg" alt="Trustera" className="h-10" />
          <span className="text-xl font-bold tracking-tight text-[#0d3d2a]">TRUSTERA</span>
        </div>
        <div className="flex gap-3">
          <Link to="/login" className="text-sm text-gray-500 hover:text-gray-800 transition-colors px-4 py-2">
            Accedi
          </Link>
          <Link to="/login" className="bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-6 py-2 rounded-lg transition-colors shadow-md shadow-green-600/20">
            Inizia Gratis
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6 text-[#0d3d2a]">
          Ancora a stampare, firmare e scannerizzare documenti?
        </h1>
        <p className="text-xl sm:text-2xl text-gray-600 mb-4">
          Con <strong className="text-green-600">Trustera</strong> firmi e invii tutto <strong className="text-gray-900">in meno di un minuto.</strong>
        </p>
        <p className="text-lg text-gray-500 mb-10">
          Ogni documento ha <strong className="text-gray-800">Audit Trail certificato</strong>: data, ora, dispositivo e firma registrati.
          <br />Cosi nessuno puo modificare il documento dopo la firma.
        </p>
        <Link to="/login" className="inline-block bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-10 rounded-xl text-lg transition-colors shadow-lg shadow-green-600/30">
          Inizia Gratis
        </Link>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { title: 'Firma digitale.', desc: 'Firma qualsiasi documento PDF con verifica OTP.' },
            { title: 'Tracciata.', desc: 'Audit trail completo: IP, data, ora, dispositivo.' },
            { title: 'Protetta.', desc: 'Hash SHA-256, documento non modificabile dopo la firma.' },
            { title: 'Gratuita.', desc: 'Piano Free senza limiti, sostenuto da offerte partner.' },
          ].map(f => (
            <div key={f.title} className="bg-white border border-gray-200 rounded-xl p-6 shadow-md shadow-green-600/5 hover:shadow-lg hover:shadow-green-600/10 transition-shadow">
              <h3 className="text-lg font-bold text-green-600 mb-2">{f.title}</h3>
              <p className="text-gray-500 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-10 text-[#0d3d2a]">Scegli il tuo piano</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-gray-200 rounded-xl p-8 shadow-md shadow-green-600/5">
            <h3 className="text-2xl font-bold text-green-600 mb-2">Free</h3>
            <p className="text-3xl font-bold text-gray-900 mb-4">0 / mese</p>
            <p className="text-gray-500 mb-6">
              Piattaforma senza costo, sostenuta da iniziative promozionali e vantaggi commerciali per gli utenti che prestano consenso.
            </p>
            <ul className="text-sm text-gray-600 space-y-2 mb-8">
              <li>Documenti illimitati</li>
              <li>Firma OTP via WhatsApp/Email</li>
              <li>Audit Trail certificato</li>
              <li>Dashboard documenti</li>
            </ul>
            <Link to="/login" className="block text-center bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg transition-colors shadow-md shadow-green-600/20">
              Inizia Gratis
            </Link>
          </div>
          <div className="bg-white border-2 border-green-500/40 rounded-xl p-8 relative shadow-lg shadow-green-600/10">
            <div className="absolute -top-3 right-6 bg-green-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              PRO
            </div>
            <h3 className="text-2xl font-bold text-green-600 mb-2">Premium</h3>
            <p className="text-3xl font-bold text-gray-900 mb-4">Prossimamente</p>
            <p className="text-gray-500 mb-6">
              Esperienza dedicata, senza utilizzo dei contatti per finalita promozionali di terzi.
            </p>
            <ul className="text-sm text-gray-600 space-y-2 mb-8">
              <li>Tutto del Free</li>
              <li>Nessuna promozione partner</li>
              <li>Branding personalizzato</li>
              <li>API access</li>
            </ul>
            <button disabled className="block w-full text-center bg-gray-200 text-gray-400 font-bold py-3 rounded-lg cursor-not-allowed">
              Prossimamente
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-16">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
          <span>Trustera - Infrastructure for Digital Trust</span>
          <div className="flex gap-6">
            <Link to="/privacy" className="hover:text-green-600 transition-colors">Privacy & GDPR</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
