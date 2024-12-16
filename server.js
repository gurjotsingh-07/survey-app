const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();

const app = express();
const port = 5000;

app.use(cors());
app.use(bodyParser.json());

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// const msg = {
//   to: 'gurjotsinghcorp@gmail.com', // Change to your recipient
//   from: 'gurjotsingh.gs2000@gmail.com', // Change to your verified sender
//   subject: 'Sending with SendGrid is Fun',
//   text: 'and easy to do anywhere, even with Node.js',
//   html: '<strong>and easy to do anywhere, even with Node.js</strong>',
// }
// sgMail
//   .send(msg)
//   .then(() => {
//     console.log('Email sent')
//   })
//   .catch((error) => {
//     console.error(error)
//   })

// Create a new survey
app.post('/api/surveys', async (req, res) => {
  const { title, questions } = req.body;
  try {
    const [result] = await db.query('INSERT INTO surveys (title) VALUES (?)', [title]);
    const surveyId = result.insertId;

    for (const question of questions) {
      await db.query('INSERT INTO questions (survey_id, text, type) VALUES (?, ?, ?)', 
        [surveyId, question.text, question.type]);
    }

    res.status(201).json({ id: surveyId, title, questions });
  } catch (error) {
    console.error('Error creating survey:', error);
    res.status(500).json({ error: 'An error occurred while creating the survey' });
  }
});

// Get all surveys
app.get('/api/surveys', async (req, res) => {
  try {
    const [surveys] = await db.query('SELECT * FROM surveys');
    for (const survey of surveys) {
      const [questions] = await db.query('SELECT * FROM questions WHERE survey_id = ?', [survey.id]);
      survey.questions = questions;
    }
    res.json(surveys);
  } catch (error) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({ error: 'An error occurred while fetching surveys' });
  }
});

// Submit a survey response
app.post('/api/responses', async (req, res) => {
  const { surveyId, responses } = req.body;
  try {
    const [result] = await db.query('INSERT INTO responses (survey_id) VALUES (?)', [surveyId]);
    const responseId = result.insertId;

    for (const [questionText, value] of Object.entries(responses)) {
      const [question] = await db.query('SELECT id FROM questions WHERE survey_id = ? AND text = ?', [surveyId, questionText]);
      if (question.length > 0) {
        await db.query('INSERT INTO answer_values (response_id, question_id, value) VALUES (?, ?, ?)', 
          [responseId, question[0].id, value]);
      }
    }

    res.status(201).json({ id: responseId, surveyId, responses });
  } catch (error) {
    console.error('Error submitting response:', error);
    res.status(500).json({ error: 'An error occurred while submitting the response' });
  }
});

// Get survey responses
app.get('/api/responses/:surveyId', async (req, res) => {
  const surveyId = parseInt(req.params.surveyId);
  try {
    const [responses] = await db.query(`
      SELECT r.id, r.created_at, q.text as question_text, av.value
      FROM responses r
      JOIN answer_values av ON r.id = av.response_id
      JOIN questions q ON av.question_id = q.id
      WHERE r.survey_id = ?
    `, [surveyId]);

    const formattedResponses = responses.reduce((acc, row) => {
      if (!acc[row.id]) {
        acc[row.id] = { id: row.id, created_at: row.created_at, responses: {} };
      }
      acc[row.id].responses[row.question_text] = row.value;
      return acc;
    }, {});

    res.json(Object.values(formattedResponses));
  } catch (error) {
    console.error('Error fetching responses:', error);
    res.status(500).json({ error: 'An error occurred while fetching responses' });
  }
});

// In your server.js or a separate routes file
app.get('/api/questions', async (req, res) => {
    try {
      const [questions] = await db.query('SELECT DISTINCT text, type FROM questions');
      res.json(questions);
    } catch (error) {
      console.error('Error fetching questions:', error);
      res.status(500).json({ error: 'An error occurred while fetching questions' });
    }
  });

// Get unpublished surveys
app.get('/api/surveys/unpublished', async (req, res) => {
  try {
    const [surveys] = await db.query(`
      SELECT s.* FROM surveys s
      LEFT JOIN published_surveys ps ON s.id = ps.survey_id
      WHERE ps.id IS NULL
    `);
    res.json(surveys);
  } catch (error) {
    console.error('Error fetching unpublished surveys:', error);
    res.status(500).json({ error: 'An error occurred while fetching unpublished surveys' });
  }
});

app.get('/api/surveys/:id', async (req, res) => {
  try {
    const [survey] = await db.query('SELECT * FROM surveys WHERE id = ?', [req.params.id]);
    console.log(survey);
    const [questions] = await db.query('SELECT * FROM questions WHERE survey_id = ?', [req.params.id]);
    survey[0].questions = questions;
    res.json(survey[0]);
  } catch (error) {
    console.error('Error fetching survey:', error);
    res.status(500).json({ error: 'An error occurred while fetching the survey' });
  }
});

  
  
  
  // Get teams
  app.get('/api/teams', async (req, res) => {
    try {
      const [teams] = await db.query('SELECT * FROM teams');
      res.json(teams);
    } catch (error) {
      console.error('Error fetching teams:', error);
      res.status(500).json({ error: 'An error occurred while fetching teams' });
    }
  });
  
  // Publish survey
  app.post('/api/surveys/publish', async (req, res) => {
    console.log("entered publish api");
    const { surveyId, teamId } = req.body;
    try {
      await db.query('INSERT INTO published_surveys (survey_id, team_id) VALUES (?, ?)', [surveyId, teamId]);
      
      // Fetch survey details
      const [survey] = await db.query('SELECT * FROM surveys WHERE id = ?', [surveyId]);
      console.log(survey);
      
      // Fetch users to notify
      let users;
      if (teamId) {
        [users] = await db.query('SELECT * FROM users WHERE team_id = ?', [teamId]);
      } else {
        [users] = await db.query('SELECT * FROM users');
      }
      console.log("user", users);
      
      // Send email notifications
      for (const user of users) {
        await sendSurveyNotification(user.email, survey[0]);
      }
      
      res.json({ message: 'Survey published successfully' });
    } catch (error) {
      console.error('Error publishing survey:', error);
      res.status(500).json({ error: 'An error occurred while publishing the survey' });
    }
  });

  app.post('/api/responses', async (req, res) => {
    const { surveyId, responses, userId } = req.body;
    try {
      // Save responses
      for (const [questionText, value] of Object.entries(responses)) {
        const [question] = await db.query('SELECT id FROM questions WHERE survey_id = ? AND text = ?', [surveyId, questionText]);
        if (question.length > 0) {
          await db.query('INSERT INTO answer_values (response_id, question_id, value) VALUES (?, ?, ?)', 
            [responseId, question[0].id, value]);
        }
      }
  
      // Record survey completion
      await db.query('INSERT INTO survey_responses (survey_id, user_id) VALUES (?, ?)', [surveyId, userId]);
  
      res.status(201).json({ message: 'Survey response recorded successfully' });
    } catch (error) {
      console.error('Error submitting response:', error);
      res.status(500).json({ error: 'An error occurred while submitting the response' });
    }
  });
  
  
  async function sendSurveyNotification(email, survey) {
    console.log("I came here");
    const msg = {
      to: email,
      from: 'gurjotsingh.gs2000@gmail.com', // Change to your verified sender
      subject: `New Survey: ${survey.title}`,
      html: `
        <h1>New Survey Available</h1>
        <p>A new survey "${survey.title}" is available for you to take.</p>
        <p>Click <a href="http://yourapp.com/take-survey/${survey.id}">here</a> to take the survey.</p>
      `
    };
  
    try {
      console.log("I entered here too");
      await sgMail.send(msg);
      console.log('Survey notification email sent');
    } catch (error) {
      console.error('Error sending survey notification email:', error);
      if (error.response) {
        console.error(error.response.body);
      }
    }
  }
  
  

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
