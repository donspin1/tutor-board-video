// login.js — обработка входа ученика
document.addEventListener('DOMContentLoaded', () => {
    const enterBtn = document.getElementById('enter-student-btn');
    if (enterBtn) {
        enterBtn.addEventListener('click', enterAsStudent);
    }

    function enterAsStudent() {
        const room = document.getElementById('roomId').value.trim();
        if (!room) {
            alert('Введите ID комнаты от репетитора!');
            return;
        }
        const name = document.getElementById('userName').value || 'Ученик';
        window.location.href = `/student.html?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}`;
    }
});