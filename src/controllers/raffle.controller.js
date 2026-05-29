const Order = require('../models/Order');
const RaffleParticipant = require('../models/RaffleParticipant');

// GET Raffle public page
const getRafflePage = async (req, res, next) => {
  try {
    res.render('pages/sorteo', {
      title: 'Sorteo AbastoHub',
      success: req.query.success || null,
      error: req.query.error || null,
      code: req.query.code || ''
    });
  } catch (error) {
    next(error);
  }
};

// POST Raffle participation
const postRegisterRaffle = async (req, res, next) => {
  try {
    let { code, name, email, phone } = req.body;
    code = code.trim().toUpperCase();

    // 1. Verify code exists
    const order = await Order.findOne({ raffleCode: code });
    if (!order) {
      return res.redirect(`/sorteo?error=${encodeURIComponent('El código ingresado no existe en nuestro sistema.')}&code=${code}`);
    }

    // 2. Check if order is accredited (paid)
    if (order.paymentStatus !== 'paid') {
      return res.redirect(`/sorteo?error=${encodeURIComponent('El pedido correspondiente a este código aún no ha sido pagado/acreditado.')}&code=${code}`);
    }

    // 3. Check if code has already been used
    if (order.raffleUsed) {
      return res.redirect(`/sorteo?error=${encodeURIComponent('Este código ya fue utilizado para registrarse en el sorteo.')}&code=${code}`);
    }

    // Double check with participant model
    const existingParticipant = await RaffleParticipant.findOne({ raffleCode: code });
    if (existingParticipant) {
      order.raffleUsed = true;
      await order.save();
      return res.redirect(`/sorteo?error=${encodeURIComponent('Este código ya fue utilizado para registrarse en el sorteo.')}&code=${code}`);
    }

    // 4. Register participant
    const participant = new RaffleParticipant({
      name,
      email,
      phone,
      order: order._id,
      raffleCode: code
    });

    await participant.save();

    // Mark order raffle as used
    order.raffleUsed = true;
    await order.save();

    res.redirect(`/sorteo?success=${encodeURIComponent('¡Felicitaciones! Te has registrado con éxito en el sorteo de AbastoHub.')}`);
  } catch (error) {
    console.error('Raffle registration error:', error.message);
    res.redirect(`/sorteo?error=${encodeURIComponent('Hubo un error al procesar tu registro: ' + error.message)}`);
  }
};

// GET Download Participants JSON (Admin Only)
const downloadParticipantsJSON = async (req, res, next) => {
  try {
    const participants = await RaffleParticipant.find().populate({
      path: 'order',
      select: 'total createdAt'
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=participantes-sorteo.json');
    res.send(JSON.stringify(participants, null, 2));
  } catch (error) {
    next(error);
  }
};

// POST Draw Winner (Admin Only)
const drawWinner = async (req, res, next) => {
  try {
    const participants = await RaffleParticipant.find();
    if (participants.length === 0) {
      return res.redirect('/admin?error=' + encodeURIComponent('No hay participantes registrados para realizar el sorteo.'));
    }

    // Select random participant
    const randomIndex = Math.floor(Math.random() * participants.length);
    const winner = participants[randomIndex];

    // Redirect back to admin with winner details
    res.redirect('/admin?success=' + encodeURIComponent(`¡Tenemos un Ganador! Código: ${winner.raffleCode} | Nombre: ${winner.name} | Teléfono: ${winner.phone}`));
  } catch (error) {
    console.error('Draw winner error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al realizar el sorteo: ' + error.message));
  }
};

// POST Clear Raffle Data (Admin Only)
const clearRaffleData = async (req, res, next) => {
  try {
    // 1. Delete all participants
    await RaffleParticipant.deleteMany({});

    // 2. Reset raffleUsed flag on all orders
    await Order.updateMany({}, { raffleUsed: false });

    res.redirect('/admin?success=' + encodeURIComponent('Se han eliminado todos los participantes y se han habilitado nuevamente los códigos para un nuevo sorteo.'));
  } catch (error) {
    console.error('Clear raffle data error:', error.message);
    res.redirect('/admin?error=' + encodeURIComponent('Error al reiniciar los datos del sorteo: ' + error.message));
  }
};

module.exports = {
  getRafflePage,
  postRegisterRaffle,
  downloadParticipantsJSON,
  drawWinner,
  clearRaffleData
};
