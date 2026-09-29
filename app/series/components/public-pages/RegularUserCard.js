'use client';
// Authenticated card and notification flow copied from app/page.js.
import {useState,useEffect} from 'react';
import {supabase} from '../../../../lib/supabase';
export default function RegularUserCard({profile,user,isDesktop,isMobile}) {
 const [notificationStatus,setNotificationStatus]=useState('');
 const [notificationLoading,setNotificationLoading]=useState(false);
 async function handleLogout(){
  const {error}=await supabase.auth.signOut({scope:'local'});
  if(error){setNotificationStatus('Impossible de se déconnecter. Réessaie.');return;}
  window.location.href='/';
 }
  function urlBase64ToUint8Array(
    base64String
  ) {
    const padding =
      "=".repeat(
        (4 -
          (base64String.length %
            4)) %
          4
      );

    const base64 =
      (
        base64String +
        padding
      )
        .replace(
          /-/g,
          "+"
        )
        .replace(
          /_/g,
          "/"
        );

    const rawData =
      window.atob(
        base64
      );

    return Uint8Array.from(
      [...rawData].map(
        (char) =>
          char.charCodeAt(
            0
          )
      )
    );
  }

  async function handleEnableNotifications() {
    if (!user) {
      setNotificationStatus(
        "Tu dois être connecté."
      );

      return;
    }

    if (
      !(
        "serviceWorker" in
        navigator
      )
    ) {
      setNotificationStatus(
        "Les notifications ne sont pas supportées sur cet appareil."
      );

      return;
    }

    if (
      !(
        "PushManager" in
        window
      )
    ) {
      setNotificationStatus(
        "Le push n’est pas supporté sur ce navigateur."
      );

      return;
    }

    const vapidPublicKey =
      process.env
        .NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    if (!vapidPublicKey) {
      setNotificationStatus(
        "Clé VAPID publique manquante."
      );

      return;
    }

    setNotificationLoading(
      true
    );

    setNotificationStatus(
      ""
    );

    try {
      const registration =
        await navigator.serviceWorker.register(
          "/sw.js"
        );

      const permission =
        await Notification.requestPermission();

      if (
        permission !==
        "granted"
      ) {
        setNotificationStatus(
          "Permission refusée."
        );

        setNotificationLoading(
          false
        );

        return;
      }

      let subscription =
        await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription =
          await registration.pushManager.subscribe(
            {
              userVisibleOnly:
                true,

              applicationServerKey:
                urlBase64ToUint8Array(
                  vapidPublicKey
                ),
            }
          );
      }

      const subscriptionJson =
        subscription.toJSON();

      const {
        error,
      } = await supabase
        .from(
          "push_subscriptions"
        )
        .upsert(
          {
            user_id:
              user.id,

            endpoint:
              subscription.endpoint,

            subscription:
              subscriptionJson,

            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict:
              "endpoint",
          }
        );

      if (error) {
        throw error;
      }

      setNotificationStatus(
        "✅ Notifications activées."
      );
    } catch (error) {
      console.error(
        "Erreur notifications :",
        error
      );

      setNotificationStatus(
        "Erreur lors de l’activation des notifications."
      );
    }

    setNotificationLoading(
      false
    );
  }

  useEffect(() => {
    async function checkNotificationStatus() {
      try {
        if (
          !("serviceWorker" in navigator) ||
          !("PushManager" in window) ||
          !("Notification" in window) ||
          Notification.permission !== "granted"
        ) {
          return;
        }

        const registration =
          await navigator.serviceWorker.register(
            "/sw.js"
          );

        const subscription =
          await registration.pushManager.getSubscription();

        if (subscription) {
          setNotificationStatus(
            "✅ Notifications activées."
          );
        }
      } catch (error) {
        console.error(
          "Erreur vérification notifications :",
          error
        );
      }
    }

    checkNotificationStatus();
  }, []);


return (              <section className="card">
                <div
                  style={{
                    display:
                      "grid",

                    gridTemplateColumns:
                      isMobile
                        ? "1fr"
                        : isDesktop
                        ? "minmax(0, 1fr) 300px"
                        : "minmax(0, 1fr) auto",

                    gap:
                      isMobile
                        ? 14
                        : isDesktop
                        ? 24
                        : 16,

                    alignItems:
                      "center",
                  }}
                >
                  <div
                    style={{
                      minWidth:
                        0,
                    }}
                  >
                    <span
                      style={{
                        display:
                          "block",

                        color:
                          "#94a3b8",

                        fontSize:
                          13,

                        fontWeight:
                          700,

                        marginBottom:
                          3,
                      }}
                    >
                      Connecté sous
                    </span>

                    <strong
                      style={{
                        display:
                          "block",

                        color:
                          "#f8fafc",

                        fontSize:
                          isMobile
                            ? 18
                            : isDesktop
                            ? 22
                            : 20,

                        fontWeight:
                          900,

                        lineHeight:
                          1.15,

                        overflowWrap:
                          "break-word",
                      }}
                    >
                      {profile?.display_name ||
                        user.email?.split(
                          "@"
                        )[0]}
                    </strong>

                    {profile?.real_name && (
                      <span
                        style={{
                          display:
                            "block",

                          marginTop:
                            3,

                          color:
                            "#94a3b8",

                          fontSize:
                            14,

                          fontWeight:
                            400,

                          lineHeight:
                            1.2,
                        }}
                      >
                        {
                          profile.real_name
                        }
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display:
                        "flex",

                      flexDirection:
                        "column",

                      gap:
                        8,

                      alignItems:
                        "stretch",
                    }}
                  >
                    <button
                      type="button"
                      className="button"
                      onClick={
                        notificationStatus.includes(
                          "✅"
                        )
                          ? undefined
                          : handleEnableNotifications
                      }
                      disabled={
                        notificationLoading ||
                        notificationStatus.includes(
                          "✅"
                        )
                      }
                      style={{
                        width:
                          isDesktop
                            ? "100%"
                            : "auto",

                        minWidth:
                          180,

                        whiteSpace:
                          "nowrap",

                        margin:
                          0,

                        background:
                          notificationStatus.includes(
                            "✅"
                          )
                            ? "#475569"
                            : undefined,

                        borderColor:
                          notificationStatus.includes(
                            "✅"
                          )
                            ? "#64748b"
                            : undefined,

                        color:
                          "#f8fafc",

                        cursor:
                          notificationStatus.includes(
                            "✅"
                          )
                            ? "default"
                            : "pointer",

                        opacity:
                          1,
                      }}
                    >
                      {notificationLoading
                        ? "Activation..."
                        : notificationStatus.includes(
                            "✅"
                          )
                        ? "✅ Notifications activées"
                        : "🔔 Activer les notifications"}
                    </button>

                    <button
                      type="button"
                      className="button-secondary"
                      onClick={
                        handleLogout
                      }
                      style={{
                        width:
                          isDesktop
                            ? "100%"
                            : "auto",

                        minWidth:
                          140,

                        whiteSpace:
                          "nowrap",

                        margin:
                          0,
                      }}
                    >
                      Se déconnecter
                    </button>
                  </div>

                  {notificationStatus &&
                    !notificationStatus.includes(
                      "✅"
                    ) && (
                      <p
                        style={{
                          marginTop:
                            12,

                          marginBottom:
                            0,

                          color:
                            "#fca5a5",

                          fontSize:
                            13,

                          fontWeight:
                            700,
                        }}
                      >
                        {
                          notificationStatus
                        }
                      </p>
                    )}
                </div>
              </section>
);
}
