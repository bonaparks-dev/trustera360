import { Link } from 'react-router-dom'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Link to="/" className="flex items-center gap-3">
            <img src="/trustera-logo.png" alt="Trustera" className="h-8" />
            <span className="text-lg font-bold text-gray-800">TRUSTERA</span>
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">
          INFORMATIVA SUL TRATTAMENTO DEI DATI PERSONALI PER FINALITA DI MARKETING
        </h1>

        <div className="prose prose-gray max-w-none space-y-4 text-gray-700 leading-relaxed">
          <p>Ai sensi del Regolamento (UE) 2016/679 ("GDPR"), previo consenso dell'utente, Trustera potra trattare i dati personali forniti durante l'utilizzo della piattaforma (quali ad esempio dati identificativi e di contatto) per finalita di marketing e comunicazioni commerciali.</p>

          <p>I dati potranno essere utilizzati per l'invio di vantaggi, offerte, promozioni e sconti dedicati relativi a prodotti o servizi che potrebbero essere di interesse per l'utente.</p>

          <p>Le comunicazioni potranno essere effettuate tramite diversi canali di contatto, tra cui, a titolo esemplificativo: email, SMS, telefono, notifiche push, applicazioni di messaggistica (come ad esempio WhatsApp) e altri strumenti di comunicazione elettronica o digitale.</p>

          <p>Previo consenso dell'utente, i dati potranno essere trattati da Trustera, partner selezionati, e resi disponibili anche attraverso DR7 Platform, una piattaforma digitale utilizzata per la gestione e la distribuzione di opportunita commerciali e offerte da parte di aziende e partner aderenti.</p>

          <p>Attraverso DR7 Platform, i dati potranno essere utilizzati da partner commerciali selezionati presenti sulla piattaforma, al fine di proporre comunicazioni commerciali, offerte, promozioni, vantaggi e sconti dedicati.</p>

          <p>Tali partner possono appartenere a diverse categorie merceologiche e settori economici, inclusi, a titolo esemplificativo ma non esaustivo, aziende operanti nei settori retail e beni di consumo, moda e abbigliamento, e-commerce, servizi digitali e tecnologici, telecomunicazioni, mobilita, turismo, energia, assicurazioni, servizi finanziari, servizi professionali, casa, benessere, tempo libero e altri prodotti o servizi potenzialmente di interesse per l'utente.</p>

          <p>Il consenso al trattamento dei dati per finalita di marketing e facoltativo e non e necessario per l'utilizzo delle funzionalita principali della piattaforma.</p>

          <p>L'utente puo revocare in qualsiasi momento il consenso prestato tramite i link di disiscrizione presenti nelle comunicazioni ricevute oppure attraverso i canali indicati nella privacy policy generale.</p>

          <p>Trustera conserva evidenza del consenso prestato, inclusi data, ora e log tecnici associati alla manifestazione di volonta dell'utente, al fine di dimostrare la liceita del trattamento.</p>

          <p>L'utente puo esercitare in qualsiasi momento i diritti previsti dagli articoli 15-22 del GDPR, tra cui accesso ai dati personali, rettifica, cancellazione, limitazione del trattamento, opposizione e portabilita dei dati.</p>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-200 text-center text-sm text-gray-400">
          <Link to="/" className="text-green-600 hover:underline">Torna alla home</Link>
        </div>
      </div>
    </div>
  )
}
