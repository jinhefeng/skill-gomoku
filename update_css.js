const fs = require('fs');
let css = fs.readFileSync('style.css', 'utf-8');
if (!css.includes('.lobby-selector')) {
    css += `

/* Game Selector Cards */
.lobby-selector {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
}
.game-cards {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
    justify-content: center;
}
.game-card {
    background: rgba(30, 41, 59, 0.8);
    border: var(--glass-border);
    border-radius: 16px;
    padding: 20px;
    width: 200px;
    cursor: pointer;
    transition: all 0.3s ease;
    text-align: left;
}
.game-card:hover {
    transform: translateY(-5px);
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--p1-color);
    box-shadow: 0 10px 20px rgba(0, 242, 255, 0.2);
}
.game-card h3 {
    margin-bottom: 10px;
    color: var(--p1-color);
}
.game-card p {
    font-size: 0.9rem;
    opacity: 0.8;
}
`;
    fs.writeFileSync('style.css', css);
    console.log("CSS updated");
} else {
    console.log("CSS already has lobby-selector");
}
