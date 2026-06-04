const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/App.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Color replacements
content = content.replace(/bg-\[#007AFF\]\/10/g, 'bg-m3-primary-container');
content = content.replace(/bg-\[#FF3B30\]\/10/g, 'bg-m3-error-container');
content = content.replace(/text-\[#007AFF\]/g, 'text-m3-primary');
content = content.replace(/border-\[#007AFF\]/g, 'border-m3-primary');
content = content.replace(/border-\[#FF3B30\]/g, 'border-m3-error');
content = content.replace(/border-\[#007AFF\]\/20/g, 'border-m3-primary/20');
content = content.replace(/border-\[#FF3B30\]\/20/g, 'border-m3-error/20');
content = content.replace(/text-\[#FF3B30\]/g, 'text-m3-error');
content = content.replace(/bg-\[#007AFF\]/g, 'bg-m3-primary');
content = content.replace(/bg-\[#FF3B30\]/g, 'bg-m3-error');
content = content.replace(/bg-\[#34C759\]/g, 'bg-green-600'); // Keep standard tailwind for success if we don't have m3 success, or use bg-m3-primary
content = content.replace(/ring-\[#007AFF\]\/20/g, 'ring-m3-primary/30');

// General M3 changes
// Rounding for main containers
content = content.replace(/rounded-2xl/g, 'rounded-[28px]');
content = content.replace(/rounded-t-3xl/g, 'rounded-t-[28px]');
content = content.replace(/rounded-xl/g, 'rounded-2xl'); // Slightly more round
content = content.replace(/rounded-lg/g, 'rounded-xl'); // Slightly more round

// Motion configurations (replace spring with M3 eased transitions)
// For Framer motion we use `ease: [0.2, 0, 0, 1]` for 'Emphasized decelerate'
// Let's replace type: 'spring' ... with ease: [0.2, 0, 0, 1]
content = content.replace(/type: 'spring', damping: \d+, stiffness: \d+/g, 'ease: [0.2, 0, 0, 1], duration: 0.4');

// Font styling for numbers
content = content.replace(/const formatCurrency = /g, 'const formatCurrency = (amount: number) => { const numStr = amount.toLocaleString(); return isComradeMode ? `${numStr}억 원` : `${numStr}₩`; }; //');
content = content.replace(/<span className="(.*?font-bold.*?)">\\s*\{formatCurrency/g, '<span className="$1 tabular-nums tracking-tight"> {formatCurrency');


// Replace typical borders with M3 elevation borders or colors
content = content.replace(/shadow-xl/g, 'shadow-sm border border-m3-outline-variant');
content = content.replace(/shadow-lg/g, 'shadow-sm border border-m3-outline-variant');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Refactoring complete');
