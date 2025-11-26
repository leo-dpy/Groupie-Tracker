function afficherToast(message, type = 'success', surConfirmation = null) {
    // Supprimer les toasts existants pour éviter l'empilement
    const existants = document.querySelectorAll('.toast');
    existants.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const texte = document.createElement('span');
    texte.textContent = message;
    toast.appendChild(texte);

    document.body.appendChild(toast);

    // Déclencher l'animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    if (type === 'error') {
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
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
                if (surConfirmation) surConfirmation();
            }, 400);
        };
        toast.appendChild(btnFermer);
    } else {
        // Fermeture automatique pour le succès
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }
}
