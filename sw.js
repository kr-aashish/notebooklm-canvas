// Service Worker for Anki Study Dashboard PWA
const CACHE_NAME = 'anki-dashboard-v1.0.0';
const STATIC_CACHE = 'anki-dashboard-static-v1';
const DYNAMIC_CACHE = 'anki-dashboard-dynamic-v1';

// Files to cache for offline functionality
const CACHE_STATIC_FILES = [
  './Anki Dashboard.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.gstatic.com',
  'https://pbs.twimg.com/profile_images/1785701767357120512/d0vRt0Gk_400x400.png'
];

// Install Event - Cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static files');
        // Cache critical files, ignore failures for external resources
        return Promise.allSettled(
          CACHE_STATIC_FILES.map(url => {
            return cache.add(url).catch(err => {
              console.warn('[SW] Failed to cache:', url, err);
              return null;
            });
          })
        );
      })
      .then(() => {
        console.log('[SW] Static files cached successfully');
        // Force activation of new service worker
        return self.skipWaiting();
      })
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Service Worker activated');
      // Take control of all pages immediately
      return self.clients.claim();
    })
  );
});

// Fetch Event - Network first, then cache strategy with fallback
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Handle API requests (JSONBin) with network-first strategy
  if (request.url.includes('api.jsonbin.io')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone and cache successful API responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached version if network fails
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return a custom offline response for API failures
            return new Response(JSON.stringify({
              record: {
                studyTasks: [],
                studyProgressState: {},
                studyDailyProgressState: {},
                studyTrackerTitle: 'Anki Dashboard (Offline)',
                studyTrackerSubtitle: 'Currently offline - data may be outdated'
              }
            }), {
              status: 200,
              statusText: 'OK (Cached)',
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }
  
  // Handle static assets and HTML pages
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        // Return cached version immediately if available
        if (cachedResponse) {
          // Still try to update cache in background for next time
          fetch(request)
            .then((response) => {
              if (response.status === 200) {
                const responseClone = response.clone();
                caches.open(STATIC_CACHE).then((cache) => {
                  cache.put(request, responseClone);
                });
              }
            })
            .catch(() => {
              // Ignore fetch errors when updating cache
            });
          
          return cachedResponse;
        }
        
        // Not in cache, try network
        return fetch(request)
          .then((response) => {
            // Cache successful responses
            if (response.status === 200) {
              const responseClone = response.clone();
              const cacheToUse = request.url.includes(location.origin) ? STATIC_CACHE : DYNAMIC_CACHE;
              
              caches.open(cacheToUse).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            // Network failed and not in cache
            if (request.destination === 'document') {
              // Return offline page for HTML requests
              return new Response(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Offline - Anki Dashboard</title>
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            background: #111827; 
                            color: #e5e7eb; 
                            display: flex; 
                            align-items: center; 
                            justify-content: center; 
                            height: 100vh; 
                            margin: 0;
                            text-align: center;
                            padding: 20px;
                        }
                        .offline-container {
                            max-width: 400px;
                        }
                        .offline-icon {
                            width: 64px;
                            height: 64px;
                            margin: 0 auto 20px;
                            opacity: 0.6;
                        }
                        h1 { color: #10b981; margin-bottom: 10px; }
                        p { opacity: 0.8; margin-bottom: 20px; }
                        button {
                            background: #10b981;
                            color: white;
                            border: none;
                            padding: 12px 24px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 16px;
                        }
                        button:hover { background: #059669; }
                    </style>
                </head>
                <body>
                    <div class="offline-container">
                        <div class="offline-icon">📚</div>
                        <h1>You're Offline</h1>
                        <p>The Anki Dashboard is not available right now. Please check your internet connection and try again.</p>
                        <button onclick="window.location.reload()">Try Again</button>
                    </div>
                </body>
                </html>
              `, {
                status: 200,
                statusText: 'OK (Offline)',
                headers: { 'Content-Type': 'text/html' }
              });
            }
            
            // For other resources, return a generic error
            return new Response('Offline - Resource not available', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});

// Background Sync for data persistence
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    console.log('[SW] Background sync triggered');
    event.waitUntil(doBackgroundSync());
  }
});

// Push notification support (for future use)
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'Study reminder from Anki Dashboard',
    icon: './icon-192x192.png',
    badge: './icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    },
    actions: [
      {
        action: 'explore',
        title: 'Open Dashboard',
        icon: './icon-192x192.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: './icon-192x192.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('Anki Dashboard', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click received');
  
  event.notification.close();
  
  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('./Anki Dashboard.html')
    );
  }
});

// Helper function for background sync
async function doBackgroundSync() {
  try {
    // This would typically sync local changes with server
    console.log('[SW] Performing background sync');
    
    // Check if there are any pending local storage changes to sync
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'BACKGROUND_SYNC_COMPLETE',
        success: true
      });
    });
    
  } catch (error) {
    console.error('[SW] Background sync failed:', error);
  }
}

// Message handling from main app
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type) {
    switch (event.data.type) {
      case 'SKIP_WAITING':
        self.skipWaiting();
        break;
      case 'CACHE_UPDATE':
        // Force cache update
        caches.delete(STATIC_CACHE).then(() => {
          caches.open(STATIC_CACHE);
        });
        break;
      default:
        console.log('[SW] Unknown message type:', event.data.type);
    }
  }
});
