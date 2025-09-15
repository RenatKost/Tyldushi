// Smooth scrolling for navigation links
document.addEventListener('DOMContentLoaded', function() {
    // Add loading animation
    document.body.classList.add('loading');
    
    // Animate hero logo on page load
    setTimeout(() => {
        const heroLogo = document.querySelector('.hero-logo');
        if (heroLogo) {
            heroLogo.style.opacity = '0';
            heroLogo.style.transform = 'scale(0.5)';
            heroLogo.style.transition = 'all 1s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            
            setTimeout(() => {
                heroLogo.style.opacity = '1';
                heroLogo.style.transform = 'scale(1)';
            }, 500);
        }
    }, 100);
    
    // Navigation links smooth scrolling
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetSection = document.querySelector(targetId);
            
            if (targetSection) {
                const headerHeight = document.querySelector('.header').offsetHeight;
                const targetPosition = targetSection.offsetTop - headerHeight;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
    
    // Active navigation highlighting
    window.addEventListener('scroll', function() {
        const sections = document.querySelectorAll('section[id]');
        const headerHeight = document.querySelector('.header').offsetHeight;
        const scrollPosition = window.scrollY + headerHeight + 100;
        
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute('id');
            const correspondingLink = document.querySelector(`.nav-link[href="#${sectionId}"]`);
            
            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                // Remove active class from all links
                navLinks.forEach(link => link.classList.remove('active'));
                // Add active class to current link
                if (correspondingLink) {
                    correspondingLink.classList.add('active');
                }
            }
        });
    });
    
    // Mobile menu toggle
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const navMenu = document.querySelector('.nav-menu');
    const mobileOverlay = document.querySelector('.mobile-menu-overlay');
    
    if (mobileMenuToggle && navMenu) {
        console.log('Mobile menu elements found'); // Debug
        
        mobileMenuToggle.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            console.log('Mobile menu toggle clicked'); // Debug
            
            const isActive = navMenu.classList.contains('active');
            
            if (isActive) {
                // Close menu
                navMenu.classList.remove('active');
                this.classList.remove('active');
                document.body.style.overflow = 'auto';
                console.log('Menu closed');
            } else {
                // Open menu
                navMenu.classList.add('active');
                this.classList.add('active');
                document.body.style.overflow = 'hidden';
                console.log('Menu opened');
                
                // Animate menu items
                setTimeout(() => {
                    animateMenuItems();
                }, 200);
            }
        });
    }
    
    // No overlay needed for fullscreen menu
    
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
            
            // Basic form validation
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
            
            // Consent checkbox validation
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
    
    // Scroll to top button
    createScrollToTopButton();
    
    // Initialize animations on scroll
    initializeScrollAnimations();
    
    // Statistics counter animation
    animateCounters();
    
    // Hero logo interaction effects
    initializeHeroLogoEffects();
    
    // Animate hero buttons on mobile
    animateHeroButtons();
});

// Modal functions
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        
        // Animate modal entrance
        const modalContent = modal.querySelector('.modal-content');
        modalContent.style.transform = 'scale(0.7)';
        modalContent.style.opacity = '0';
        
        setTimeout(() => {
            modalContent.style.transition = 'all 0.3s ease';
            modalContent.style.transform = 'scale(1)';
            modalContent.style.opacity = '1';
        }, 10);
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        const modalContent = modal.querySelector('.modal-content');
        modalContent.style.transform = 'scale(0.7)';
        modalContent.style.opacity = '0';
        
        setTimeout(() => {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }, 300);
    }
}

// Close modal when clicking outside
window.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal')) {
        const modalId = event.target.id;
        closeModal(modalId);
    }
});

// Close modal with Escape key
window.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        const openModals = document.querySelectorAll('.modal[style*="block"]');
        openModals.forEach(modal => {
            closeModal(modal.id);
        });
    }
});

// Notification system
function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => notification.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-message">${message}</span>
            <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    // Add notification styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 3000;
        max-width: 400px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    const notificationContent = notification.querySelector('.notification-content');
    notificationContent.style.cssText = `
        padding: 1rem 1.5rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
    `;
    
    const closeButton = notification.querySelector('.notification-close');
    closeButton.style.cssText = `
        background: none;
        border: none;
        font-size: 1.5rem;
        cursor: pointer;
        color: inherit;
        opacity: 0.7;
    `;
    
    // Set colors based on type
    switch (type) {
        case 'success':
            notification.style.background = '#2ecc71';
            notification.style.color = 'white';
            break;
        case 'error':
            notification.style.background = '#e74c3c';
            notification.style.color = 'white';
            break;
        default:
            notification.style.background = '#3498db';
            notification.style.color = 'white';
    }
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                notification.remove();
            }, 300);
        }
    }, 5000);
}

// Scroll to top button
function createScrollToTopButton() {
    const scrollButton = document.createElement('button');
    scrollButton.innerHTML = '<i class="fas fa-arrow-up"></i>';
    scrollButton.className = 'scroll-to-top';
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
        transition: all 0.3s ease;
        box-shadow: 0 2px 10px rgba(74, 60, 124, 0.4);
    `;
    
    scrollButton.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
    
    document.body.appendChild(scrollButton);
    
    // Show/hide scroll button
    window.addEventListener('scroll', function() {
        if (window.scrollY > 300) {
            scrollButton.style.opacity = '1';
            scrollButton.style.visibility = 'visible';
        } else {
            scrollButton.style.opacity = '0';
            scrollButton.style.visibility = 'hidden';
        }
    });
    
    // Hover effect
    scrollButton.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = '0 4px 15px rgba(74, 60, 124, 0.5)';
    });
    
    scrollButton.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = '0 2px 10px rgba(74, 60, 124, 0.4)';
    });
}

// Scroll animations
function initializeScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Animate cards and sections
    const elementsToAnimate = document.querySelectorAll(`
        .report-card,
        .fundraising-card,
        .project-card,
        .stat-item,
        .contact-item
    `);
    
    elementsToAnimate.forEach((element, index) => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(30px)';
        element.style.transition = `all 0.6s ease ${index * 0.1}s`;
        observer.observe(element);
    });
}

// Counter animation
function animateCounters() {
    const counters = document.querySelectorAll('.stat-number');
    const observerOptions = {
        threshold: 0.5
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const counter = entry.target;
                const target = parseInt(counter.textContent.replace(/,/g, ''));
                const duration = 2000;
                const step = target / (duration / 16);
                let current = 0;
                
                const timer = setInterval(() => {
                    current += step;
                    if (current >= target) {
                        current = target;
                        clearInterval(timer);
                    }
                    counter.textContent = Math.floor(current).toLocaleString();
                }, 16);
                
                observer.unobserve(counter);
            }
        });
    }, observerOptions);
    
    counters.forEach(counter => {
        observer.observe(counter);
    });
}

// Payment button handlers
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('payment-btn')) {
        const paymentType = e.target.textContent.trim();
        showNotification(`Перенаправлення на платіжну систему ${paymentType}...`, 'info');
        
        // Here you would integrate with actual payment systems
        setTimeout(() => {
            showNotification('Функція буде доступна найближчим часом', 'info');
        }, 2000);
    }
});

// File upload handling
document.addEventListener('change', function(e) {
    if (e.target.type === 'file') {
        const files = e.target.files;
        const fileInfo = document.createElement('div');
        fileInfo.className = 'file-info';
        fileInfo.style.cssText = `
            margin-top: 0.5rem;
            font-size: 0.9rem;
            color: #7f8c8d;
        `;
        
        if (files.length > 0) {
            const fileNames = Array.from(files).map(file => file.name).join(', ');
            fileInfo.textContent = `Обрано файлів: ${files.length} (${fileNames})`;
        } else {
            fileInfo.textContent = '';
        }
        
        // Remove existing file info
        const existingInfo = e.target.parentElement.querySelector('.file-info');
        if (existingInfo) {
            existingInfo.remove();
        }
        
        e.target.parentElement.appendChild(fileInfo);
    }
});

// Form field validation
document.addEventListener('input', function(e) {
    const field = e.target;
    if (field.hasAttribute('required')) {
        if (field.value.trim()) {
            field.style.borderColor = '#2ecc71';
        } else {
            field.style.borderColor = '#ecf0f1';
        }
    }
    
    // Email validation
    if (field.type === 'email' && field.value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(field.value)) {
            field.style.borderColor = '#2ecc71';
        } else {
            field.style.borderColor = '#e74c3c';
        }
    }
    
    // Phone validation
    if (field.type === 'tel' && field.value) {
        const phoneRegex = /^[\+]?[0-9\s\-\(\)]+$/;
        if (phoneRegex.test(field.value) && field.value.length >= 10) {
            field.style.borderColor = '#2ecc71';
        } else {
            field.style.borderColor = '#e74c3c';
        }
    }
});

// Close mobile menu when clicking on nav links
document.addEventListener('click', function(e) {
    const navMenu = document.querySelector('.nav-menu');
    const mobileToggle = document.querySelector('.mobile-menu-toggle');
    
    // Close menu when clicking nav links
    if (e.target.classList.contains('nav-link') && navMenu && navMenu.classList.contains('active')) {
        // Add closing animation
        const menuLinks = document.querySelectorAll('.nav-menu .nav-link');
        
        menuLinks.forEach((link, index) => {
            setTimeout(() => {
                link.style.transform = 'translateY(-15px) scale(0.95)';
                link.style.opacity = '0';
            }, index * 40);
        });
        
        // Close menu after animation
        setTimeout(() => {
            navMenu.classList.remove('active');
            if (mobileToggle) mobileToggle.classList.remove('active');
            document.body.style.overflow = 'auto';
        }, 300);
    }
});

// Progress bar animation
function animateProgressBars() {
    const progressBars = document.querySelectorAll('.progress');
    const observerOptions = {
        threshold: 0.5
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const progressBar = entry.target;
                const width = progressBar.style.width;
                progressBar.style.width = '0%';
                
                setTimeout(() => {
                    progressBar.style.transition = 'width 2s ease';
                    progressBar.style.width = width;
                }, 500);
                
                observer.unobserve(progressBar);
            }
        });
    }, observerOptions);
    
    progressBars.forEach(bar => {
        observer.observe(bar);
    });
}

// Initialize progress bar animation when page loads
document.addEventListener('DOMContentLoaded', animateProgressBars);

// Add CSS for mobile menu animations only
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
        
        /* Mobile action buttons in hero section */
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
            transform: translateY(0);
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            box-shadow: 0 4px 15px rgba(74, 60, 124, 0.2);
        }
        
        .hero-buttons .btn:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(74, 60, 124, 0.3);
        }
        
        .hero-buttons .btn:active {
            transform: translateY(-1px);
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

// Hero logo interaction effects
function initializeHeroLogoEffects() {
    const heroLogo = document.querySelector('.hero-logo');
    const logoGlow = document.querySelector('.logo-glow');
    
    if (heroLogo) {
        // Click effect
        heroLogo.addEventListener('click', function() {
            // Create ripple effect
            const ripple = document.createElement('div');
            ripple.style.cssText = `
                position: absolute;
                border-radius: 50%;
                background: rgba(74, 60, 124, 0.4);
                pointer-events: none;
                transform: scale(0);
                animation: ripple 0.8s ease-out;
                top: 50%;
                left: 50%;
                width: 100px;
                height: 100px;
                margin-left: -50px;
                margin-top: -50px;
            `;
            
            this.parentElement.appendChild(ripple);
            
            // Remove ripple after animation
            setTimeout(() => {
                ripple.remove();
            }, 800);
            
            // Bonus animation
            this.style.animation = 'none';
            setTimeout(() => {
                this.style.animation = 'heroLogoFloat 4s ease-in-out infinite';
            }, 10);
        });
        
        // Mouse movement parallax effect
        const container = heroLogo.closest('.hero-logo-container');
        if (container) {
            container.addEventListener('mousemove', function(e) {
                const rect = this.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                
                const mouseX = e.clientX - centerX;
                const mouseY = e.clientY - centerY;
                
                const rotateX = (mouseY / rect.height) * 10;
                const rotateY = (mouseX / rect.width) * -10;
                
                heroLogo.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
                
                if (logoGlow) {
                    logoGlow.style.transform = `translate(-50%, -50%) translate(${mouseX * 0.1}px, ${mouseY * 0.1}px)`;
                }
            });
            
            container.addEventListener('mouseleave', function() {
                heroLogo.style.transform = '';
                if (logoGlow) {
                    logoGlow.style.transform = 'translate(-50%, -50%)';
                }
            });
        }
        
        // Double click for special effect
        let clickCount = 0;
        heroLogo.addEventListener('click', function() {
            clickCount++;
            setTimeout(() => {
                if (clickCount === 2) {
                    // Special double-click effect
                    this.style.filter = 'drop-shadow(0 0 30px rgba(212, 175, 55, 0.9)) brightness(1.2)';
                    setTimeout(() => {
                        this.style.filter = 'drop-shadow(0 10px 20px rgba(0, 0, 0, 0.1))';
                    }, 1000);
                }
                clickCount = 0;
            }, 300);
        });
    }
}

// Add ripple animation CSS
const rippleCSS = `
    @keyframes ripple {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;

// Animate hero buttons on mobile
function animateHeroButtons() {
    if (window.innerWidth <= 768) {
        const heroButtons = document.querySelectorAll('.hero-buttons .btn');
        
        // Initial state
        heroButtons.forEach((btn, index) => {
            btn.style.opacity = '0';
            btn.style.transform = 'translateY(30px)';
            btn.style.transition = 'all 0.6s ease';
        });
        
        // Animate in sequence
        setTimeout(() => {
            heroButtons.forEach((btn, index) => {
                setTimeout(() => {
                    btn.style.opacity = '1';
                    btn.style.transform = 'translateY(0)';
                }, index * 200);
            });
        }, 800);
        
        // Add bounce effect on click
        heroButtons.forEach(btn => {
            btn.addEventListener('click', function() {
                this.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    this.style.transform = 'scale(1)';
                }, 150);
            });
        });
    }
}

// Add pulse animation to buttons
function addButtonPulse() {
    if (window.innerWidth <= 768) {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes buttonPulse {
                0% { box-shadow: 0 4px 15px rgba(74, 60, 124, 0.2); }
                50% { box-shadow: 0 6px 20px rgba(74, 60, 124, 0.4); }
                100% { box-shadow: 0 4px 15px rgba(74, 60, 124, 0.2); }
            }
            
            @media (max-width: 768px) {
                .hero-buttons .btn {
                    animation: buttonPulse 2s ease-in-out infinite;
                }
                
                .hero-buttons .btn:hover {
                    animation: none;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// Animate menu items when opening
function animateMenuItems() {
    const menuLinks = document.querySelectorAll('.nav-menu .nav-link');
    
    console.log('Found menu links:', menuLinks.length); // Debug
    
    if (menuLinks.length === 0) {
        console.log('No menu links found!');
        return;
    }
    
    // Reset and animate menu links
    menuLinks.forEach((link, index) => {
        link.style.opacity = '0';
        link.style.transform = 'translateY(20px) scale(0.95)';
        link.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        
        // Reset icon animation
        const icon = link.querySelector('i');
        if (icon) {
            icon.style.transform = 'scale(0) rotate(-180deg)';
            icon.style.transition = 'all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
        }
        
        // Animate in sequence
        setTimeout(() => {
            link.style.opacity = '1';
            link.style.transform = 'translateY(0) scale(1)';
            
            // Animate icon
            if (icon) {
                setTimeout(() => {
                    icon.style.transform = 'scale(1) rotate(0deg)';
                }, 100);
            }
        }, index * 80 + 100);
    });
}

// Add touch support for mobile menu
function addTouchSupport() {
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('touchstart', function(e) {
            e.preventDefault();
            this.click();
        });
    }
}

// Initialize button animations
setTimeout(addButtonPulse, 1000);

// Add touch support
addTouchSupport();

// Inject mobile menu CSS and ripple CSS
const styleSheet = document.createElement('style');
styleSheet.textContent = mobileMenuCSS + rippleCSS;
document.head.appendChild(styleSheet);
