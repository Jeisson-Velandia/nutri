# Nutri

App personal de calorías y macros con cámara. PWA (React + Vite + Tailwind) que se instala en el iPhone desde Safari y se publica gratis en GitHub Pages.

## Qué hace

- **Plato:** foto → Gemini identifica ingredientes y estima gramos → revisas, ajustas y guardas.
- **Código de barras:** lector en el navegador (ZXing) + Open Food Facts.
- **Etiqueta:** foto a la tabla nutricional → la IA extrae los valores → confirmas.
- **Texto:** "2 huevos pericos y una arepa con queso" → la IA lo calcula.
- Dashboard con anillo de calorías, macros, agua y comidas del día.
- Metas con Mifflin-St Jeor según actividad y objetivo.
- Datos solo en el teléfono (IndexedDB), con exportar/importar respaldo.

## Desarrollo

```bash
npm install
npm run dev        # abre la URL "Network" desde el iPhone (misma WiFi)
npm run build
```

Nota: en desarrollo por la red local (http) la cámara de video no arranca en iOS, así que el lector de códigos de barras solo funciona en la versión publicada (https). Las fotos sí funcionan.

## Publicar

1. Sube el repo a GitHub (debe ser público para usar Pages gratis).
2. Settings → Pages → Source: **GitHub Actions**.
3. Cada push a `main` publica en `https://<usuario>.github.io/<repo>/`.

## Cuenta y sincronización (Firebase)

Mismo método que FP: Firebase Authentication (correo y contraseña) + Firestore. La app guarda todo local (IndexedDB) y sincroniza con `users/{uid}/records` cuando hay sesión.

1. Pega el `firebaseConfig` del proyecto en `src/config.ts`.
2. Publica las reglas de `firestore.rules` (Firestore → Reglas).

## API key

Crea una key gratis en https://aistudio.google.com/apikey y pégala en **Ajustes** dentro de la app. Nunca la pongas en el código: el repositorio es público.
