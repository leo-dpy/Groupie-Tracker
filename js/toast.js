function showToast(message, type = 'success', onConfirm = null) {
    // Remove existing toasts to avoid stacking too many
    const existing = document.querySelectorAll('.toast');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    if (type === 'error') {
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'OK';
        closeBtn.style.marginLeft = '15px';
        closeBtn.style.background = 'rgba(255,255,255,0.1)';
        closeBtn.style.border = '1px solid rgba(255,255,255,0.2)';
        closeBtn.style.color = 'white';
        closeBtn.style.padding = '4px 10px';
        closeBtn.style.borderRadius = '12px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontSize = '12px';
        
        closeBtn.onclick = () => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.remove();
                if (onConfirm) onConfirm();
            }, 400);
        };
        toast.appendChild(closeBtn);
    } else {
        // Auto close for success
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }
}
