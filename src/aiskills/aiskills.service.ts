// src/aiskills/aiskills.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { SisService } from '../sis/sis.service';
import { CourseService } from '../courses/course.service';
import { TranscriptDto } from '../dtos/transcript.dto';

import * as onetData from './saved_matches_no_tech.json';
import * as courseSkillData from './havover_cleaned_courses.json';

interface OnetOccupation {
  occupation_title: string;
  matches: string[];
}

interface CourseSkillsEntry {
  name: string;
  code: string;
  university: string;
  description: string;
  Matches: {
    Abilities: string[];
    TechAndTools: string[];
    Skills: string[];
    Knowledge: string[];
  };
}

@Injectable()
export class AiSkillsService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly sisService: SisService,
    private readonly courseService: CourseService,
  ) {}

  // Puts the transcript into format which is accepted by sendPromptToOpenAI
  private formatTranscript(transcript: any): string {
    let terms = transcript.terms;

    if (typeof terms === 'string') {
      try {
        terms = JSON.parse(terms);
      } catch (error) {
        console.error('Failed to parse transcript terms:', error);
        return '\nInvalid terms format.';
      }
    }

    if (!Array.isArray(terms)) {
      return '\nNo terms or courses found.';
    }

    const courseBlocks = terms
      .map((term: any) => {
        if (!Array.isArray(term.courses)) {
          return `\nNo courses found for term ${term.termYear}.`;
        }

        return term.courses
          .map((course: any) => {
            const courseInfo = this.courseService.getCourseInfo(course.courseTitle);

            if (courseInfo.error) {
              return `
                Course Title: ${course.courseTitle}
                Course Code: ${course.courseCode}
                Error: ${courseInfo.error}
              `;
            }

            // Updated property names here:
            const techSkills = Array.isArray(courseInfo.techAndTools)
              ? courseInfo.techAndTools.join(', ')
              : 'None';

            const skills = Array.isArray(courseInfo.skills)
              ? courseInfo.skills.join(', ')
              : 'None';

            const abilities = Array.isArray(courseInfo.abilities)
              ? courseInfo.abilities.join(', ')
              : 'None';

            const knowledge = Array.isArray(courseInfo.knowledge)
              ? courseInfo.knowledge.join(', ')
              : 'None';

            return `
              Course Title: ${course.courseTitle}
              Course Code: ${course.courseCode}
              Description: ${courseInfo.description}
              University: ${courseInfo.university}

              ||Predicted Technical Skills||: ${techSkills}
              ||Predicted Skills||: ${skills}
              ||Predicted Abilities||: ${abilities}
              ||Predicted Knowledge||: ${knowledge}
            `;
          })
          .join('\n');
      })
      .join('\n');

    return courseBlocks;
  }

  // Main code which executes the process
  async getTranscriptAndSendToAI(studentNumber: string): Promise<{ json: string; topMatches: any[] }> {
    console.log(`Fetching transcript for student number: ${studentNumber}`);

    const transcript: TranscriptDto = await this.sisService.getStudentTranscript(studentNumber);
    if (!transcript) {
      throw new Error('Transcript not found');
    }

    // Format the transcript
    const transcriptFormatted = this.formatTranscript(transcript);
    const prompt = `${transcriptFormatted}`;

    console.log('\n=== GENERATED PROMPT ===');
    console.log(prompt);
    console.log('=== END OF PROMPT ===\n');

    // Analytical response
    const response = await this.sendPromptToOpenAI(prompt);

    console.log('\n=== GENERATED ANALYTICAL RESPONSE ===');
    console.log(response);
    console.log('=== END OF ANALYTICAL RESPONSE ===\n');

    // JSON formatting response this is the format of json_response, which is what AI Skills returns
    const jsonSchema = {
      type: 'object',
      properties: {
        Abilities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              afiliated_courses: { type: 'array', items: { type: 'string' } },
              level: { type: 'integer' },
            },
            required: ['name', 'afiliated_courses', 'level'],
          },
        },
        'Tech and Tools': {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              afiliated_courses: { type: 'array', items: { type: 'string' } },
              level: { type: 'integer' },
            },
            required: ['name', 'afiliated_courses', 'level'],
          },
        },
        Skills: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              afiliated_courses: { type: 'array', items: { type: 'string' } },
              level: { type: 'integer' },
            },
            required: ['name', 'afiliated_courses', 'level'],
          },
        },
        Knowledge: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              afiliated_courses: { type: 'array', items: { type: 'string' } },
              level: { type: 'integer' },
            },
            required: ['name', 'afiliated_courses', 'level'],
          },
        },
      },
      required: ['Abilities', 'Tech and Tools', 'Skills', 'Knowledge'],
    };

    const json_prompt = `
      Hello there, I have an analytical response from another ChatGPT. What I need you to do is retrieve the '5. Final List' and put the listed Abilities, Tech and Tools, Skills, and Knowledge into the corresponding JSON structure which will also be provided to you.
      That list also has additional information, such as the affiliated_courses in [], and the Level, which must also be added to the given JSON schema. 

      This is the ChatGPT’s response I would like you to retrieve the '5. Final List' from. MAKE ABSOLUTE SURE THAT YOU COPY THE WORDS AS THEY ARE, LETTER FOR LETTER:
      ${response}
    `;

    const json_response = await this.sendJsonSchemaRequest(json_prompt, jsonSchema);

    console.log('\n=== GENERATED JSON RESPONSE ===');
    console.log(json_response);
    console.log('=== END OF JSON RESPONSE ===\n');

    // Ensure terms are in an array
    let termsData: any = transcript.terms;
    if (typeof termsData === 'string') {
      try {
        termsData = JSON.parse(termsData);
      } catch (err) {
        console.error('Failed to parse transcript.terms as JSON:', err);
        termsData = [];
      }
    }

    // Get the course titles from the transcript 
    const allCourseTitles: string[] = [];
    if (Array.isArray(termsData)) {
      for (const term of termsData) {
        if (Array.isArray(term.courses)) {
          for (const course of term.courses) {
            if (typeof course.courseTitle === 'string') {
              allCourseTitles.push(course.courseTitle);
            }
          }
        }
      }
    } else {
      console.warn('Expected transcript.terms to be an array after parsing, but got:', termsData);
    }
    
    console.log('\n=== START OF allCourseTitles used for the matching ===');
    console.log(allCourseTitles);
    console.log('=== END OF allCourseTitles used for the matching ===\n');

    // Get the top matches
    const top_matches = this.findTopOccupationMatches(allCourseTitles);

    console.log('\n=== GENERATED topMatches ===');
    console.log(top_matches);
    console.log('=== END OF topMatches ===\n');

    return {
	    json: json_response,
	    topMatches: top_matches,
	  };
    // The json_responce contains a list of "Abilities", "Tech and Tools", "Skills", "Knowledge" along with the 
    // courses where a given skill is derived from. It also includes a value "Level" which suggests how fimilar the
    // student is with some skill.
    
    // The top_matches contains a list of 5 occupations the students skills mostly fall under. It contains the 
    // occupation title, "occupation", the percentage of match "percentage", the matched skills "matchedSkills", 
    // and a few other values.
  }

  // Sending the prompt to OpenAI for analytical analysis
  private async sendPromptToOpenAI(prompt: string): Promise<string> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const openaiUrl = 'https://api.openai.com/v1/chat/completions';

    let depth: number = 2; // Select the depth of skills which will be outputed (1, 2, 3), this doesn't relate to the "top_matches"
    let depthPrompt: string = '';

    if (depth === 1) {
      depthPrompt = '(Abilities: 5, Tech and Tools: 3, Skills: 3, and Knowledge: 3)';
    } else if (depth === 2) {
      depthPrompt = '(Abilities: 10, Tech and Tools: 6, Skills: 5, and Knowledge: 5)';
    } else if (depth === 3) {
      depthPrompt = '(Abilities: 26, Tech and Tools: 9, Skills: 6, and Knowledge: 6)';
    } else {
      depthPrompt = '(Abilities: 5, Tech and Tools: 3, Skills: 3, and Knowledge: 3)'; // default
    }

    const response = await lastValueFrom(
      this.httpService.post(
        openaiUrl,
        {
          model: 'gpt-4.1-mini',
          messages: [
            {
              role: 'system',
              content: `
                You work in a high school education environment; specifically, you specialize in understanding which skills, technology, and knowledge students gain from completing specific high school courses. Your main objective today is taking in student transcripts and listing the abilities, tech and tools, skills, and knowledge that the student is most likely to have, assuming they have completed all courses and retained knowledge from them.
                It must be clarified that we only have the description of the course, and nothing else. This means that many decisions you make are educational approximations; therefore, assumptions are acceptable, but must be justified with solid evidence from a course’s description.
                To make the job easier, we have already pre-selected a list of "matches" (e.g., Abilities, Tech and Tools, Skills, and Knowledge) that students gain for individual courses. Those matches are also assumptions; we have tried our best to select the most fitting ones.
                Here is your task: Given a student’s full transcript (usually 12–24 courses), which includes the courses' titles, descriptions, and matches, you must create a sophisticated and justifiable list of (Abilities, Tech and Tools, Skills, and Knowledge) that the student is most likely to have. Key point: Your job here is to have the grand view of the student and their interests; you must recognize that these courses are interconnected and will require deep analysis.
                Another key point: You must recognize that your job is the grand view, therefore reflection is a key step here. Please follow this protocol.

                ### 1. Objective
                At the beginning, state your objective and what you are trying to achieve. Recognize that your goal is the grand view of all courses the student has completed.

                ### 2. First Look
                At the first look, write a sentence about what you think the student is passionate about; try to understand who they are. If there is no clear pattern, say so—some students are still lost and haven’t decided a career direction.

                ### 3. Analysis
                For each course, list the (Abilities, Tech and Tools, Skills, and Knowledge), and describe how they connect to the student’s vision and the course. Then estimate the level of familiarity and/or experience the student would have with a given (Abilities, Tech and Tools, Skills, and Knowledge) on a scale of 1/10, and justify it.

                ### 4. Interconnection
                Recognize that education is a complex system; when a student is taught multiple courses, their knowledge may interconnect and mix. Analyze each course and try to understand whether any course fits with another; if so, what other (Abilities, Tech and Tools, Skills, and Knowledge) might the student gain from them combined.

                ### 5. Final Decision
                Remember that you have a specific max limit of (Abilities, Tech and Tools, Skills, and Knowledge) you may list: ${depthPrompt}. Therefore, choose wisely. If there are fewer skills than the given value, do not make up skills—leave it. THE SKILL NAME MUST MATCH AS PROVIDED IN THE STUDENT’S TRANSCRIPT, LETTER FOR LETTER.

                Print out your final selections in a neat list with headings (Abilities, Tech and Tools, Skills, and Knowledge). We require your output to be in a specific format and have specific additional information, apart from simply the name of the skills. Please follow this template.

                This is your template—change anything in {}, but anything outside, do not change:
                {Category}
                x. {Skill Name}
                [{list the courses which attribute to the skill}] [Level: {the 1/10 scale of familiarity you provided in the analysis}]

                Finally, the user will provide you with the transcript in JSON format.
              `,
            },
            { role: 'user', content: prompt },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        },
      ),
    );

    const result = response.data.choices[0].message.content;
    console.log('OpenAI response:', result);
    return result;
  }

  // Sending the prompt to openai to convert into JSON
  private async sendJsonSchemaRequest(prompt: string, jsonSchema: object): Promise<any> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const openaiUrl = 'https://api.openai.com/v1/chat/completions';

    const response = await lastValueFrom(
      this.httpService.post(
        openaiUrl,
        {
          model: 'gpt-4.1-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant which helps transform user inputs into a structured JSON response.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'CourseInfo',
                description: 'Extracts structured abilities, skills, tech/tools, and knowledge based on input.',
                parameters: jsonSchema,
              },
            },
          ],
          tool_choice: {
            type: 'function',
            function: {
              name: 'CourseInfo',
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    const toolCalls = response.data.choices?.[0]?.message?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      throw new Error('No tool call found in OpenAI response.');
    }

    const jsonArgs = toolCalls[0].function.arguments;
    try {
      return JSON.parse(jsonArgs);
    } catch (err) {
      throw new Error('Failed to parse function.arguments as JSON.');
    }
  }

  // Find top 5 occupation matches based on course names ===>
  public findTopOccupationMatches(courseNames: string[]): Array<{occupation: string, matchCount: number, totalPossible: number, percentage: number, matchedSkills: string[] }> {
    const studentSkillSet = new Set<string>();
    const allCourses: CourseSkillsEntry[] = (courseSkillData as any) as CourseSkillsEntry[];
    
    for (const c of allCourses) {
      if (courseNames.includes(c.name)) {
        const m = c.Matches;

        if (Array.isArray(m.Abilities)) {
          m.Abilities.forEach(skill => studentSkillSet.add(skill));
        }

        //if (Array.isArray(m.TechAndTools)) {
        //  m.TechAndTools.forEach(skill => studentSkillSet.add(skill)); // To be enabled if using the "saved_matches.json" instead of "saved_matches_no_tech.json"
        //}

        if (Array.isArray(m.Skills)) {
          m.Skills.forEach(skill => studentSkillSet.add(skill));
        }

        if (Array.isArray(m.Knowledge)) {
          m.Knowledge.forEach(skill => studentSkillSet.add(skill));
        }
      }
    }

    console.log('\n=== GENERATED studentSkillSet ===');
    console.log(studentSkillSet);
    console.log('=== END OF studentSkillSet ===\n');

    // Search the ONET dataset
    const allOccupations: OnetOccupation[] = (onetData as any) as OnetOccupation[];

    // Score each occupation
    const scored = allOccupations.map((occ) => {
      let matchCount = 0;
      const matchedSkills: string[] = [];

      for (const skill of occ.matches) {
        if (studentSkillSet.has(skill)) {
          matchCount++;
          matchedSkills.push(skill);
        }
      }

      const totalPossible = occ.matches.length || 1; // Avoid divide-by-zero
      const percentage = parseFloat(((matchCount / totalPossible) * 100).toFixed(1));

      return {
        occupation: occ.occupation_title,
        matchCount,
        totalPossible,
        percentage,
        matchedSkills,
      };
    });

    // Sort by descending order
    scored.sort((a, b) => b.matchCount - a.matchCount);

    return scored.slice(0, 5);
  }
}

