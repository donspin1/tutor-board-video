document.addEventListener('DOMContentLoaded', function() {
    const loginBtn = document.getElementById('login-tutor-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', loginTutor);
    }

    function generateRoomId() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    function loginTutor() {
        const login = document.getElementById('login').value;
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('error-message');

        if (login === 'matdushki' && password === '221123Victor') {
            const roomId = generateRoomId();
            window.location.href = `/tutor.html?room=${roomId}&name=Репетитор`;
        } else {
            errorEl.innerText = 'Неверный логин или пароль';
        }
    }
});