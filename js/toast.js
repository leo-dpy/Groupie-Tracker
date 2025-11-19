function showToast(message, type = 'success', onConfirm = null) {
    // Remove existing toasts to avoid stacking too many
    const existing = document.querySelectorAll('.toast');
    existing.forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    if (type === 'error') {
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'OK';
        closeBtn.style.marginLeft = '15px';
        closeBtn.style.background = '#e91e63';
        closeBtn.style.border = 'none';
        closeBtn.style.color = 'white';
        closeBtn.style.padding = '6px 12px';
        closeBtn.style.borderRadius = '6px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.fontWeight = 'bold';
        
        closeBtn.onclick = () => {
            toast.style.opacity = '0';
            setTimeout(() => {
                toast.remove();
                if (onConfirm) onConfirm();
            }, 300);
        };
        toast.appendChild(closeBtn);
    } else {
        // Auto close for success
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    document.body.appendChild(toast);
}
