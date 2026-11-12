// Configuración pública del proyecto de Firebase (Configuración del proyecto → Tus apps → web).
// Es pública por diseño, como en FP: la seguridad la dan las reglas de Firestore (firestore.rules).
export const firebaseConfig = {
  apiKey: 'AIzaSyBc4yd4CV6gyC52VNiqi3pvk1326GRtiWA',
  authDomain: 'nutri-961c8.firebaseapp.com',
  projectId: 'nutri-961c8',
  storageBucket: 'nutri-961c8.firebasestorage.app',
  messagingSenderId: '821265214000',
  appId: '1:821265214000:web:84788b4b4e9d51a6e29bf5',
}

export const syncEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)
