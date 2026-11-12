// Configuración pública del proyecto de Firebase (Configuración del proyecto → Tus apps → web).
// Es pública por diseño, como en FP: la seguridad la dan las reglas de Firestore (firestore.rules).
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
}

export const syncEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)
