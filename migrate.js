// Importações necessárias do Firebase Admin e do módulo 'fs'
const admin = require('firebase-admin');
const fs = require('fs').promises;
const path = require('path');

// Carregue suas credenciais do Firebase
// Preferir via variável de ambiente GOOGLE_APPLICATION_CREDENTIALS
const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './serviceAccountKey.json';
if (!require('fs').existsSync(credsPath)) {
  console.error('Arquivo de credenciais não encontrado. Defina GOOGLE_APPLICATION_CREDENTIALS com o caminho para seu serviceAccountKey.json.');
  process.exit(1);
}
const serviceAccount = require(credsPath);

// Inicialize o app do Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Obtenha uma referência para o banco de dados Firestore
const db = admin.firestore();

// Função principal assíncrona para fazer a migração
async function migrateData() {
  try {
    // Caminho para o seu arquivo JSON com os dados das câmeras
    const jsonFilePath = path.join(__dirname, 'cameras_info.json');
    
    // Leia o arquivo JSON
    const jsonData = await fs.readFile(jsonFilePath, 'utf8');
    
    // Converta o conteúdo do arquivo de string para um objeto JavaScript (array)
    const cameras = JSON.parse(jsonData);

    if (!Array.isArray(cameras) || cameras.length === 0) {
      console.log('O arquivo JSON está vazio ou não é um array válido. Nenhuma ação foi tomada.');
      return;
    }

    console.log(`Encontradas ${cameras.length} câmeras no arquivo JSON. Iniciando migração...`);

    // Use um "batch" para enviar os dados de forma mais eficiente
    const batch = db.batch();

    // Itere sobre cada câmera no seu array
    cameras.forEach(camera => {
      // Verificações e valores padrão para garantir a consistência dos dados
      const codigo = camera.codigo;
      if (!codigo) {
        console.warn('Câmera sem código encontrada, será ignorada:', camera);
        return; // Pula para a próxima iteração
      }
      
      const docRef = db.collection('cameras').doc(codigo);
      
      // Monta o objeto de dados final, garantindo que o 'level' padrão seja 1
      const dataToSet = {
        codigo: camera.codigo,
        nome: camera.nome || `Câmera ${codigo}`,
        categoria: camera.categoria || "Sem Categoria",
        descricao: camera.descricao || "",
        coords: camera.coords || null,
        level: typeof camera.level === 'number' ? camera.level : 1 // Garante que 'level' é 1 se não estiver definido
      };

      batch.set(docRef, dataToSet);
    });

    // Envie o lote de operações para o Firestore
    await batch.commit();

    console.log('----------------------------------------------------');
    console.log('✔ SUCESSO! A migração foi concluída.');
    console.log(`✔ ${cameras.length} documentos foram enviados para a coleção "cameras".`);
    console.log('----------------------------------------------------');

  } catch (error) {
    console.error('❌ ERRO DURANTE A MIGRAÇÃO:', error);
    console.log('Por favor, verifique se o caminho para o "serviceAccountKey.json" e "cameras_info.json" está correto.');
  }
}

// Chame a função para iniciar o processo
migrateData();
