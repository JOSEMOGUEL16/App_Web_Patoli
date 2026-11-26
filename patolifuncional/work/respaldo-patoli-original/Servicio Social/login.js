const formulario = document.getElementById("form-login");
const mensaje = document.getElementById("login-mensaje");

formulario.addEventListener("submit", (evento) => {
  evento.preventDefault();
  mensaje.textContent = "El inicio de sesión estará disponible cuando conectemos el sistema de usuarios.";
});