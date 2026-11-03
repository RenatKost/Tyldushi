// Site behaviour: navigation, mobile menu, modals, forms, notifications.
// Animations live in js/motion.js (window.Motion).
const motion = () => window.Motion || { enabled: false, modalIn: m => { m.style.display = 'block'; }, modalOut: (m, done) => { m.style.display = 'none'; done && done(); }, menuIn() {} };

document.addEventListener('DOMContentLoaded', function() {
    const header = document.querySelector('.header');
    const navLinks = document.querySelectorAll('.nav-link');

    // Smooth scrolling for in-page anchors only (links like /organizations navigate normally)
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href') || '';
            if (!href.startsWith('#')) return;
            const targetSection = document.querySelector(href);
            if (!targetSection) return;
            e.preventDefault();
            window.scrollTo({
                top: targetSection.offsetTop - header.offsetHeight,
                behavior: 'smooth'
            });
        });
    });

    // Active navigation highlighting
    const sections = document.querySelectorAll('section[id]');
    if (sections.length) {
        window.addEventListener('scroll', function() {
            const scrollPosition = window.scrollY + header.offsetHeight + 100;
            sections.forEach(section => {
                const correspondingLink = document.querySelector(`.nav-link[href="#${section.id}"]`);
                if (scrollPosition >= section.offsetTop && scrollPosition < section.offsetTop + section.offsetHeight) {
                    navLinks.forEach(link => link.classList.remove('active'));
                    if (correspondingLink) correspondingLink.classList.add('active');
                }
            });
        }, { passive: true });
    }

    // Mobile menu toggle
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const navMenu = document.querySelector('.nav-menu');

    if (mobileMenuToggle && navMenu) {
        mobileMenuToggle.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const isActive = navMenu.classList.toggle('active');
            this.classList.toggle('active', isActive);
            document.body.style.overflow = isActive ? 'hidden' : '';
            if (isActive) motion().menuIn(navMenu);
        });
    }

    // Form submission handlers
    const contactForm = document.querySelector('.contact-form form');
    const helpRequestForm = document.getElementById('helpRequestForm');

    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            showNotification('Дякуємо за ваше повідомлення! Ми зв\'яжемося з вами найближчим часом.', 'success');
            this.reset();
        });
    }

    if (helpRequestForm) {
        helpRequestForm.addEventListener('submit', function(e) {
            e.preventDefault();

            const requiredFields = this.querySelectorAll('[required]');
            let isValid = true;

            requiredFields.forEach(field => {
                if (!field.value.trim()) {
                    field.style.borderColor = '#e74c3c';
                    isValid = false;
                } else {
                    field.style.borderColor = '#ecf0f1';
                }
            });

            const consentCheckbox = this.querySelector('input[name="consent"]');
            if (!consentCheckbox.checked) {
                showNotification('Будь ласка, дайте згоду на обробку персональних даних', 'error');
                isValid = false;
            }

            if (isValid) {
                showNotification('Вашу заявку успішно подано! Ми розглянемо її протягом 3-5 робочих днів.', 'success');
                this.reset();
                closeModal('receiveModal');
            } else {
                showNotification('Будь ласка, заповніть всі обов\'язкові поля', 'error');
            }
        });
    }

    createScrollToTopButton();
});

// Modal functions
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    document.body.style.overflow = 'hidden';
    motion().modalIn(modal);
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal || modal.style.display !== 'block') return;
    motion().modalOut(modal, () => {
        document.body.style.overflow = '';
    });
}

// Close modal when clicking outside
window.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal')) {
        closeModal(event.target.id);
    }
});

// Close modal with Escape key
window.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(modal => {
            if (modal.style.display === 'block') closeModal(modal.id);
        });
    }
});

// Notification system
function showNotification(message, type = 'info') {
    document.querySelectorAll('.notification').forEach(notification => notification.remove());

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message"></span>
            <button class="notification-close" aria-label="Закрити">×</button>
        </div>
    `;
    notification.querySelector('.notification-message').textContent = message;
    notification.querySelector('.notification-close').addEventListener('click', () => notification.remove());

    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 3000;
        max-width: 400px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transform: translateX(120%);
        transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;

    notification.querySelector('.notification-content').style.cssText = `
        padding: 1rem 1.5rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    `;

    notification.querySelector('.notification-close').style.cssText = `
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: inherit;
        opacity: 0.7;
    `;

    const colors = { success: '#2ecc71', error: '#e74c3c' };
    notification.style.background = colors[type] || '#4a3c7c';
    notification.style.color = 'white';

    document.body.appendChild(notification);

    requestAnimationFrame(() => {
        notification.style.transform = 'translateX(0)';
    });

    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.transform = 'translateX(120%)';
            setTimeout(() => notification.remove(), 400);
        }
    }, 5000);
}

// Scroll to top button
function createScrollToTopButton() {
    const scrollButton = document.createElement('button');
    scrollButton.innerHTML = '<i class="fas fa-arrow-up"></i>';
    scrollButton.className = 'scroll-to-top';
    scrollButton.setAttribute('aria-label', 'Нагору');
    scrollButton.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #4a3c7c, #3d3366);
        color: white;
        border: none;
        cursor: pointer;
        font-size: 1.2rem;
        z-index: 1000;
        opacity: 0;
        visibility: hidden;
        transform: translateY(20px);
        transition: all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        box-shadow: 0 2px 10px rgba(74, 60, 124, 0.4);
    `;

    scrollButton.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    document.body.appendChild(scrollButton);

    window.addEventListener('scroll', function() {
        const visible = window.scrollY > 300;
        scrollButton.style.opacity = visible ? '1' : '0';
        scrollButton.style.visibility = visible ? 'visible' : 'hidden';
        scrollButton.style.transform = visible ? 'translateY(0)' : 'translateY(20px)';
    }, { passive: true });
}

// Payment button handlers
document.addEventListener('click', function(e) {
    const button = e.target.closest('.payment-btn');
    if (button) {
        const paymentType = button.textContent.trim();
        showNotification(`Перенаправлення на платіжну систему ${paymentType}...`, 'info');
        setTimeout(() => {
            showNotification('Функція буде доступна найближчим часом', 'info');
        }, 2000);
    }
});

// File upload handling
document.addEventListener('change', function(e) {
    if (e.target.type === 'file' && e.target.closest('.help-form')) {
        const files = e.target.files;
        const existingInfo = e.target.parentElement.querySelector('.file-info');
        if (existingInfo) existingInfo.remove();
        if (!files.length) return;

        const fileInfo = document.createElement('div');
        fileInfo.className = 'file-info';
        fileInfo.style.cssText = 'margin-top: 0.5rem; font-size: 0.9rem; color: #7f8c8d;';
        fileInfo.textContent = `Обрано файлів: ${files.length} (${Array.from(files).map(file => file.name).join(', ')})`;
        e.target.parentElement.appendChild(fileInfo);
    }
});

// Form field validation
document.addEventListener('input', function(e) {
    const field = e.target;
    if (!field.closest('.help-form, .contact-form')) return;

    if (field.hasAttribute('required')) {
        field.style.borderColor = field.value.trim() ? '#2ecc71' : '#ecf0f1';
    }

    if (field.type === 'email' && field.value) {
        field.style.borderColor = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value) ? '#2ecc71' : '#e74c3c';
    }

    if (field.type === 'tel' && field.value) {
        const ok = /^[\+]?[0-9\s\-\(\)]+$/.test(field.value) && field.value.length >= 10;
        field.style.borderColor = ok ? '#2ecc71' : '#e74c3c';
    }
});

// Close mobile menu when clicking on nav links
document.addEventListener('click', function(e) {
    const link = e.target.closest('.nav-link');
    const navMenu = document.querySelector('.nav-menu');
    const mobileToggle = document.querySelector('.mobile-menu-toggle');

    if (link && navMenu && navMenu.classList.contains('active')) {
        navMenu.classList.remove('active');
        if (mobileToggle) mobileToggle.classList.remove('active');
        document.body.style.overflow = '';
    }
});

// Mobile menu icon and hero button styles
const mobileMenuCSS = `
    @media (max-width: 768px) {
        .mobile-menu-toggle.active span:nth-child(1) {
            transform: rotate(-45deg) translate(-5px, 6px);
            background: var(--sandy-gold);
        }

        .mobile-menu-toggle.active span:nth-child(2) {
            opacity: 0;
            transform: translateX(20px);
        }

        .mobile-menu-toggle.active span:nth-child(3) {
            transform: rotate(45deg) translate(-5px, -6px);
            background: var(--sandy-gold);
        }

        .hero-buttons {
            margin-top: 2rem;
            flex-direction: row;
            gap: 1rem;
            width: 100%;
            justify-content: center;
        }

        .hero-buttons .btn {
            flex: 1;
            max-width: 180px;
            padding: 1rem 1.5rem;
            font-size: 0.95rem;
            border-radius: 25px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(74, 60, 124, 0.2);
        }

        .hero-buttons .btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
            transition: left 0.5s;
        }

        .hero-buttons .btn:hover::before {
            left: 100%;
        }
    }
`;

const styleSheet = document.createElement('style');
styleSheet.textContent = mobileMenuCSS;
document.head.appendChild(styleSheet);
