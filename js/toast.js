/**
 * Affiche une notification temporaire à l'écran.
 * @param {string} message - Le texte à afficher.
 * @param {string} type - Le type de notification ('success' ou 'error').
 * @param {function} surConfirmation - Fonction de rappel optionnelle lors de la fermeture manuelle.
 */
function afficherNotification(message, type = 'success', surConfirmation = null) {
    // Supprimer les notifications existantes pour éviter l'empilement
    const existants = document.querySelectorAll('.toast');
    existants.forEach(t => t.remove());

    const notification = document.createElement('div');
    notification.className = `toast ${type}`;
    
    const texte = document.createElement('span');
    texte.textContent = message;
    notification.appendChild(texte);

    document.body.appendChild(notification);

    // Déclencher l'animation d'apparition
    requestAnimationFrame(() => {
        notification.classList.add('show');
    });

    if (type === 'error') {
        // Bouton de fermeture pour les erreurs
        const btnFermer = document.createElement('button');
        btnFermer.textContent = 'OK';
        btnFermer.style.marginLeft = '15px';
        btnFermer.style.background = 'rgba(255,255,255,0.1)';
        btnFermer.style.border = '1px solid rgba(255,255,255,0.2)';
        btnFermer.style.color = 'white';
        btnFermer.style.padding = '4px 10px';
        btnFermer.style.borderRadius = '12px';
        btnFermer.style.cursor = 'pointer';
        btnFermer.style.fontSize = '12px';
        
        btnFermer.onclick = () => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
                if (surConfirmation) surConfirmation();
            }, 400);
        };
        notification.appendChild(btnFermer);
    } else {
        // Fermeture automatique pour les succès après 3 secondes
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 400);
        }, 3000);
    }
}

